/**
 * 一次网关请求的前置检查：令牌鉴权、别名解析、额度检查。都是同步的 SQLite 查询。
 */
import { rolloverAppPeriods, type AppRow } from '../api/apps'
import { effectiveTokenStatus, TOKEN_STATUS, type TokenRow } from '../api/tokens'
import { getUpstream, type UpstreamRow } from '../api/upstreams'
import { hashTokenKey } from '../crypto'
import { db, parseJsonArray } from '../db'
import { GatewayError } from './errors'

export interface GatewayAuth {
  token: TokenRow
  app: AppRow
}

export interface RouteTarget {
  alias: string
  upstream: UpstreamRow
  upstreamModel: string
}

const AUTH_FAILED = '令牌无效、已过期或已被禁用'

function authError(detail: string) {
  return new GatewayError('authentication_error', 'invalid_token', AUTH_FAILED, detail)
}

/** 校验 Authorization: Bearer sk-...；所有失败对外都是同一个 401，原因只进日志 */
export function authenticate(authorization: string | null, ip: string): GatewayAuth {
  const key = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!key) throw authError('缺少 Bearer 令牌')

  const token = db().prepare('SELECT * FROM tokens WHERE key_hash = ?').get(hashTokenKey(key)) as
    | TokenRow
    | undefined
  if (!token) throw authError('令牌不存在')

  const status = effectiveTokenStatus(token)
  if (status === TOKEN_STATUS.DISABLED) throw authError(`令牌 #${token.id} 已禁用`)
  if (status === TOKEN_STATUS.EXPIRED) throw authError(`令牌 #${token.id} 已过期`)

  const app = db().prepare('SELECT * FROM apps WHERE id = ?').get(token.app_id) as AppRow | undefined
  if (!app || app.status !== 1) throw authError(`令牌 #${token.id} 所属应用已禁用`)

  if (token.allow_ips.trim() && !ipAllowed(ip, token.allow_ips)) {
    throw authError(`令牌 #${token.id} 不允许来源 IP ${ip}`)
  }
  return { token, app }
}

/** 别名必须在令牌白名单里，并且是令牌所属应用的别名 */
export function resolveAlias(auth: GatewayAuth, model: unknown): RouteTarget {
  if (typeof model !== 'string' || !model) {
    throw new GatewayError('invalid_request_error', 'missing_model', '请求里缺少 model（模型别名）')
  }
  const notFound = new GatewayError(
    'invalid_request_error',
    'model_not_found',
    `模型别名 ${model} 不存在，或这个令牌不能使用它`
  )
  if (!parseJsonArray(auth.token.models).includes(model)) throw notFound

  const alias = db()
    .prepare('SELECT upstream_id, upstream_model FROM aliases WHERE app_id = ? AND name = ?')
    .get(auth.app.id, model) as { upstream_id: number; upstream_model: string } | undefined
  if (!alias) throw notFound

  const upstream = getUpstream(alias.upstream_id)
  if (!upstream || upstream.status !== 1) {
    throw new GatewayError('upstream_unavailable', 'upstream_disabled', `模型别名 ${model} 的上游已停用`)
  }
  return { alias: model, upstream, upstreamModel: alias.upstream_model }
}

/** 请求前检查令牌和应用都还有余额；不预占，请求结束后按实际用量扣 */
export function checkQuota(auth: GatewayAuth) {
  const { token } = auth
  if (token.quota > 0 && token.used >= token.quota) {
    throw new GatewayError('insufficient_quota', 'token_quota_exhausted', '令牌额度已用尽')
  }
  rolloverAppPeriods()
  const app = db().prepare('SELECT quota, used FROM apps WHERE id = ?').get(auth.app.id) as {
    quota: number
    used: number
  }
  if (app.quota > 0 && app.used >= app.quota) {
    throw new GatewayError('insufficient_quota', 'app_quota_exhausted', '应用额度已用尽')
  }
}

// ---------------------------------------------------------------------------
// IP 白名单：逗号或空白分隔，支持单个 IP 和 IPv4 CIDR（如 192.168.1.0/24）
// ---------------------------------------------------------------------------

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    const v = Number(part)
    if (!/^\d{1,3}$/.test(part) || v > 255) return null
    n = n * 256 + v
  }
  return n
}

export function ipAllowed(ip: string, allowList: string): boolean {
  const normalized = ip.replace(/^::ffff:/, '')
  for (const entry of allowList.split(/[\s,]+/).filter(Boolean)) {
    if (!entry.includes('/')) {
      if (entry === normalized) return true
      continue
    }
    const [base, bitsText] = entry.split('/')
    const bits = Number(bitsText)
    const target = ipv4ToNumber(normalized)
    const network = ipv4ToNumber(base)
    if (target === null || network === null || !(bits >= 0 && bits <= 32)) continue
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    if (((target & mask) >>> 0) === ((network & mask) >>> 0)) return true
  }
  return false
}
