/**
 * 令牌：一台设备或一个服务实例一个，归属于应用。后台沿用 NewAPI 的令牌接口（/api/token），
 * 返回 NewAPI 令牌的格式。
 *
 * 库里只存密钥的哈希，明文只在创建和重新生成时返回一次。
 * 令牌没有自己的额度和模型白名单：额度只在应用上，令牌能用所属应用的全部别名。used 只用来统计。
 */
import { generateTokenKey, hashTokenKey } from '../crypto'
import { db, nowSeconds, transaction } from '../db'
import { fail, ok, pageParams } from '../router'
import { getApp } from './apps'
import { route } from './registry'

export interface TokenRow {
  id: number
  app_id: number
  name: string
  key_hash: string
  key_prefix: string
  key_last4: string
  status: number
  expires_at: number
  quota: number
  used: number
  models: string
  allow_ips: string
  created_at: number
  last_used_at: number
}

/** NewAPI 的令牌状态：1 启用，2 禁用，3 已过期（按过期时间现算） */
export const TOKEN_STATUS = { ENABLED: 1, DISABLED: 2, EXPIRED: 3 } as const

export function effectiveTokenStatus(row: TokenRow, now = nowSeconds()): number {
  if (row.status === TOKEN_STATUS.DISABLED) return TOKEN_STATUS.DISABLED
  if (row.expires_at !== -1 && row.expires_at <= now) return TOKEN_STATUS.EXPIRED
  return TOKEN_STATUS.ENABLED
}

const KEY_NOT_STORED = '令牌明文只在创建时显示一次，服务端不保存。丢了可以在操作菜单里“重新生成”'

function toToken(row: TokenRow & { app_slug?: string }) {
  return {
    id: row.id,
    user_id: row.app_id,
    app_name: row.app_slug ?? '',
    name: row.name,
    // 前端会加 sk- 前缀显示
    key: `${row.key_prefix}****${row.key_last4}`,
    status: effectiveTokenStatus(row),
    used_quota: row.used,
    expired_time: row.expires_at,
    created_time: row.created_at,
    accessed_time: row.last_used_at,
    allow_ips: row.allow_ips,
  }
}

const SELECT_WITH_APP = 'SELECT t.*, a.slug AS app_slug FROM tokens t JOIN apps a ON a.id = t.app_id'

function getToken(id: number) {
  return db().prepare(`${SELECT_WITH_APP} WHERE t.id = ?`).get(id) as (TokenRow & { app_slug: string }) | undefined
}

function listTokens(query: URLSearchParams) {
  const { page, size, offset } = pageParams(query)
  const keyword = (query.get('keyword') ?? '').trim()
  const appId = Number(query.get('app_id') ?? 0)
  const conditions: string[] = []
  const args: (string | number)[] = []
  if (keyword) {
    conditions.push('(t.name LIKE ? OR a.slug LIKE ?)')
    args.push(`%${keyword}%`, `%${keyword}%`)
  }
  if (appId) {
    conditions.push('t.app_id = ?')
    args.push(appId)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const { total } = db()
    .prepare(`SELECT COUNT(*) AS total FROM tokens t JOIN apps a ON a.id = t.app_id ${where}`)
    .get(...args) as { total: number }
  const rows = db()
    .prepare(`${SELECT_WITH_APP} ${where} ORDER BY t.id DESC LIMIT ? OFFSET ?`)
    .all(...args, size, offset) as unknown as (TokenRow & { app_slug: string })[]
  return ok({ items: rows.map(toToken), total, page, page_size: size })
}

interface TokenInput {
  user_id?: unknown
  name?: unknown
  expired_time?: unknown
  allow_ips?: unknown
}

/** 校验表单。令牌所属应用新建时取自表单，之后不能转移 */
function readTokenInput(input: TokenInput) {
  const fields: Record<string, string | number> = {}

  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return { error: '请填写令牌名称' }
  fields.name = name.slice(0, 64)

  const expires = Number(input.expired_time ?? -1)
  if (!Number.isInteger(expires) || (expires !== -1 && expires <= 0)) return { error: '过期时间不对' }
  fields.expires_at = expires

  fields.allow_ips = typeof input.allow_ips === 'string' ? input.allow_ips.trim() : ''
  return { fields }
}

function newKeyFields() {
  const key = generateTokenKey()
  return { key, key_hash: hashTokenKey(key), key_prefix: key.slice(0, 4), key_last4: key.slice(-4) }
}

route('GET', '/api/token', ({ query }) => listTokens(query))
route('GET', '/api/token/search', ({ query }) => listTokens(query))

route('GET', '/api/token/:id', ({ params }) => {
  const row = getToken(Number(params.id))
  return row ? ok(toToken(row)) : fail('令牌不存在')
})

// 创建：返回的 key 是明文（不带 sk-），只这一次
route('POST', '/api/token', ({ body }) => {
  const input = (body ?? {}) as TokenInput
  const app = getApp(Number(input.user_id))
  if (!app) return fail('请选择应用')
  const { fields, error } = readTokenInput(input)
  if (error || !fields) return fail(error ?? '参数错误')
  const { key, ...keyFields } = newKeyFields()
  const all = { ...fields, ...keyFields, app_id: app.id, created_at: nowSeconds() }
  const columns = Object.keys(all)
  const result = db()
    .prepare(`INSERT INTO tokens (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...Object.values(all))
  return ok({ ...toToken(getToken(Number(result.lastInsertRowid))!), key })
})

route('PUT', '/api/token', ({ body, query }) => {
  const input = (body ?? {}) as TokenInput & { id?: unknown; status?: unknown }
  const row = getToken(Number(input.id))
  if (!row) return fail('令牌不存在')

  if (query.get('status_only')) {
    const status = Number(input.status) === TOKEN_STATUS.ENABLED ? TOKEN_STATUS.ENABLED : TOKEN_STATUS.DISABLED
    db().prepare('UPDATE tokens SET status = ? WHERE id = ?').run(status, row.id)
    return ok(toToken(getToken(row.id)!))
  }

  const { fields, error } = readTokenInput(input)
  if (error || !fields) return fail(error ?? '参数错误')
  const entries = Object.entries(fields)
  db()
    .prepare(`UPDATE tokens SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), row.id)
  return ok(toToken(getToken(row.id)!))
})

// 重新生成密钥：旧密钥立即失效，新明文只返回这一次
route('POST', '/api/token/:id/regenerate', ({ params }) => {
  const row = getToken(Number(params.id))
  if (!row) return fail('令牌不存在')
  const { key, key_hash, key_prefix, key_last4 } = newKeyFields()
  db()
    .prepare('UPDATE tokens SET key_hash = ?, key_prefix = ?, key_last4 = ? WHERE id = ?')
    .run(key_hash, key_prefix, key_last4, row.id)
  return ok({ ...toToken(getToken(row.id)!), key })
})

route('POST', '/api/token/:id/key', () => fail(KEY_NOT_STORED))
route('POST', '/api/token/batch/keys', () => fail(KEY_NOT_STORED))

route('DELETE', '/api/token/:id', ({ params }) => {
  const result = db().prepare('DELETE FROM tokens WHERE id = ?').run(Number(params.id))
  return result.changes ? ok() : fail('令牌不存在')
})

route('POST', '/api/token/batch', ({ body }) => {
  const ids = (body as { ids?: unknown })?.ids
  if (!Array.isArray(ids)) return fail('参数错误')
  const deleted = transaction(() =>
    ids.reduce<number>((n, id) => n + Number(db().prepare('DELETE FROM tokens WHERE id = ?').run(Number(id)).changes), 0)
  )
  return ok(deleted)
})
