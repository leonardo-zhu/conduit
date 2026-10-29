/**
 * 网关请求结束后的异常检测，发现问题就记事件（见 ../events.ts）。
 *
 * - 上游：401 / 403 记“密钥失效”，429 记“限流”，连续 3 次 5xx / 超时 / 连不上记“连续失败”
 * - 额度：应用或令牌的用量这次越过 80% / 100% 时记一次；用尽后被拒的请求计入“用尽”的次数
 * - 错误率：应用最近 10 分钟至少 10 个请求、上游类失败占一半以上
 *
 * 调用方断开（499）和参数错误（4xx）是调用方的问题，不算异常。
 */
import { db, nowSeconds } from '../db'
import { safeRaiseEvent, type EventField } from '../events'
import type { GatewayAuth, RouteTarget } from './context'

const FAILING_STREAK = 3
const QUOTA_WARNING_RATIO = 0.8
const ERROR_RATE_WINDOW = 600
const ERROR_RATE_MIN_REQUESTS = 10
const ERROR_RATE_CHECK_INTERVAL = 60

/** 上游类失败：鉴权、限流、5xx（含网关记的 502 连不上、504 超时） */
const UPSTREAM_FAILURE_SQL = 'status_code IN (401, 403, 429) OR status_code >= 500'

function isUpstreamFailure(status: number) {
  return status === 401 || status === 403 || status === 429 || status >= 500
}

// 只在内存里记：重启后从零开始，不影响什么
const globalRef = globalThis as typeof globalThis & {
  __conduitFailStreak?: Map<number, number>
  __conduitErrorRateChecked?: Map<number, number>
}
const failStreak = (globalRef.__conduitFailStreak ??= new Map())
const errorRateChecked = (globalRef.__conduitErrorRateChecked ??= new Map())

const logsLink = (params: Record<string, string | number>) =>
  `/usage-logs/common?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`

const formatTokens = (n: number) => n.toLocaleString('en-US')
const percent = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`

/** handler.ts 记的上游错误是“上游返回 401：<响应正文>”，推送时只要正文 */
const upstreamBody = (error: string) => error.replace(/^上游返回 \d+：/, '').slice(0, 500)

export interface RequestOutcome {
  auth: GatewayAuth
  target: RouteTarget
  statusCode: number
  error: string
  /** 这次扣的额度 */
  charge: number
}

export function checkAfterRequest(outcome: RequestOutcome) {
  try {
    checkUpstream(outcome)
    checkQuotaCrossing(outcome)
    if (isUpstreamFailure(outcome.statusCode)) checkErrorRate(outcome.auth)
  } catch (error) {
    console.error('[alerts] 检测失败', error)
  }
}

function checkUpstream({ auth, target, statusCode, error }: RequestOutcome) {
  const { upstream } = target
  const base = { subjectType: 'upstream' as const, subjectId: upstream.id, subjectName: upstream.name }
  // 是哪个请求撞上的，方便判断影响面
  const trigger: EventField = ['触发请求', `${auth.app.slug} / ${target.alias} → ${target.upstreamModel}`]

  if (statusCode === 200 && !error) {
    failStreak.delete(upstream.id)
    return
  }
  if (statusCode === 401 || statusCode === 403) {
    safeRaiseEvent({
      ...base,
      kind: 'upstream_auth',
      level: 'error',
      title: `服务商 ${upstream.name} 拒绝了密钥（${statusCode}）`,
      detail: `密钥可能失效、欠费或没有这个模型的权限。${error}`.slice(0, 500),
      link: '/channels',
      fields: [['服务商', upstream.name], ['状态码', String(statusCode)], trigger, ['可能原因', '密钥失效、欠费或没有这个模型的权限']],
      raw: upstreamBody(error),
    })
    return
  }
  if (statusCode === 429) {
    safeRaiseEvent({
      ...base,
      kind: 'upstream_rate_limit',
      level: 'warning',
      title: `服务商 ${upstream.name} 限流（429）`,
      detail: error.slice(0, 500),
      link: logsLink({ channel: upstream.id }),
      fields: [['服务商', upstream.name], ['状态码', '429'], trigger],
      raw: upstreamBody(error),
    })
    return
  }
  if (statusCode >= 500) {
    const streak = (failStreak.get(upstream.id) ?? 0) + 1
    failStreak.set(upstream.id, streak)
    if (streak >= FAILING_STREAK) {
      safeRaiseEvent({
        ...base,
        kind: 'upstream_failing',
        level: 'error',
        title: `服务商 ${upstream.name} 连续 ${streak} 次失败`,
        detail: `最近一次：${error}`.slice(0, 500),
        link: logsLink({ channel: upstream.id }),
        fields: [['服务商', upstream.name], ['连续失败', `${streak} 次`], ['状态码', String(statusCode)], trigger],
        raw: upstreamBody(error),
      })
    }
  }
}

function checkQuotaCrossing({ auth, charge }: RequestOutcome) {
  if (charge <= 0) return
  const app = db().prepare('SELECT quota, used FROM apps WHERE id = ?').get(auth.app.id) as
    | { quota: number; used: number }
    | undefined
  if (app) {
    quotaCrossing({
      quota: app.quota,
      used: app.used,
      charge,
      subjectType: 'app',
      subjectId: auth.app.id,
      subjectName: auth.app.slug,
      label: `应用 ${auth.app.slug}`,
      link: '/apps',
    })
  }
  const token = db().prepare('SELECT quota, used FROM tokens WHERE id = ?').get(auth.token.id) as
    | { quota: number; used: number }
    | undefined
  if (token) {
    quotaCrossing({
      quota: token.quota,
      used: token.used,
      charge,
      subjectType: 'token',
      subjectId: auth.token.id,
      subjectName: `${auth.app.slug} / ${auth.token.name}`,
      label: `令牌 ${auth.app.slug} / ${auth.token.name}`,
      link: '/keys',
    })
  }
}

function quotaCrossing(args: {
  quota: number
  used: number
  charge: number
  subjectType: 'app' | 'token'
  subjectId: number
  subjectName: string
  label: string
  link: string
}) {
  const { quota, used, charge } = args
  if (quota <= 0) return
  const before = used - charge
  const detail = `额度 ${formatTokens(quota)} tokens，已用 ${formatTokens(used)}`
  const base = { subjectType: args.subjectType, subjectId: args.subjectId, subjectName: args.subjectName, link: args.link }
  const fields: EventField[] = [
    [args.subjectType === 'app' ? '应用' : '令牌', args.subjectName],
    ['额度', `${formatTokens(quota)} tokens`],
    ['已用', `${formatTokens(used)} tokens（${percent(used, quota)}）`],
  ]
  if (before < quota && used >= quota) {
    safeRaiseEvent({
      ...base,
      kind: 'quota_exhausted',
      level: 'error',
      title: `${args.label} 的额度已用尽`,
      detail,
      fields: [...fields, ['影响', '之后的请求会被拒绝（429）']],
    })
  } else if (before < quota * QUOTA_WARNING_RATIO && used >= quota * QUOTA_WARNING_RATIO) {
    safeRaiseEvent({ ...base, kind: 'quota_warning', level: 'warning', title: `${args.label} 的额度已用 80%`, detail, fields })
  }
}

/** 额度用尽后被网关拒绝的请求（这些请求不写用量记录） */
export function noteQuotaRejected(auth: GatewayAuth, scope: 'app' | 'token') {
  const isApp = scope === 'app'
  const label = isApp ? `应用 ${auth.app.slug}` : `令牌 ${auth.app.slug} / ${auth.token.name}`
  const name = isApp ? auth.app.slug : `${auth.app.slug} / ${auth.token.name}`
  safeRaiseEvent({
    kind: 'quota_exhausted',
    level: 'error',
    subjectType: scope,
    subjectId: isApp ? auth.app.id : auth.token.id,
    subjectName: name,
    title: `${label} 的额度已用尽`,
    detail: '额度用尽后被拒绝的请求也计入次数',
    link: isApp ? '/apps' : '/keys',
    fields: [
      [isApp ? '应用' : '令牌', name],
      ['影响', '请求被拒绝（429），调整额度或等下个周期重置'],
    ],
  })
}

function checkErrorRate(auth: GatewayAuth) {
  const now = nowSeconds()
  if (now - (errorRateChecked.get(auth.app.id) ?? 0) < ERROR_RATE_CHECK_INTERVAL) return

  const stats = db()
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(${UPSTREAM_FAILURE_SQL}), 0) AS failed
       FROM usage_logs WHERE app_id = ? AND created_at >= ?`
    )
    .get(auth.app.id, now - ERROR_RATE_WINDOW) as { total: number; failed: number }
  // 请求数还不够时不算一次检查，免得刚开始失败的那一分钟里漏掉
  if (stats.total < ERROR_RATE_MIN_REQUESTS) return
  errorRateChecked.set(auth.app.id, now)
  if (stats.failed * 2 < stats.total) return

  safeRaiseEvent({
    kind: 'error_rate',
    level: 'warning',
    subjectType: 'app',
    subjectId: auth.app.id,
    subjectName: auth.app.slug,
    title: `应用 ${auth.app.slug} 的请求大量失败`,
    detail: `最近 10 分钟 ${stats.total} 个请求，${stats.failed} 个因服务商问题失败`,
    link: logsLink({ username: auth.app.slug }),
    fields: [
      ['应用', auth.app.slug],
      ['最近 10 分钟', `${stats.total} 个请求`],
      ['服务商类失败', `${stats.failed} 个（${percent(stats.failed, stats.total)}）`],
    ],
  })
}
