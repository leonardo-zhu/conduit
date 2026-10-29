/**
 * 用量记录的查询：使用日志（/api/log）和数据看板（/api/data）。按 NewAPI 的格式返回：
 * 日志的 username 是应用标识，model_name 是别名，channel 是上游。
 *
 * 记录由网关在每个请求结束时写入（阶段 3），这里只读。
 */
import { db } from '../db'
import { ok, pageParams } from '../router'
import { route } from './registry'

interface UsageRow {
  id: number
  request_id: string
  app_id: number | null
  app_slug: string
  token_id: number | null
  token_name: string
  alias: string
  upstream_id: number | null
  upstream_name: string
  upstream_model: string
  input_tokens: number
  output_tokens: number
  is_stream: number
  status_code: number
  error: string
  first_token_ms: number
  duration_ms: number
  estimated: number
  ip: string
  created_at: number
}

/** NewAPI 的日志类型：2 消耗，5 错误 */
const LOG_TYPE = { CONSUME: 2, ERROR: 5 } as const

/**
 * 扣了额度的记录都算消耗：包括调用方中途断开、按估算扣的那些（error 不为空但有 token）。
 * 只有没扣额度的才算错误，看板和日志统计都按这个口径，和实际扣减对得上
 */
const CHARGED = "(error = '' OR input_tokens + output_tokens > 0)"

function toLog(row: UsageRow) {
  const failed = row.error !== '' && row.input_tokens + row.output_tokens === 0
  return {
    id: row.id,
    user_id: row.app_id ?? 0,
    created_at: row.created_at,
    type: failed ? LOG_TYPE.ERROR : LOG_TYPE.CONSUME,
    content: row.error,
    username: row.app_slug,
    token_name: row.token_name,
    token_id: row.token_id ?? 0,
    model_name: row.alias,
    quota: row.input_tokens + row.output_tokens,
    prompt_tokens: row.input_tokens,
    completion_tokens: row.output_tokens,
    use_time: Math.round(row.duration_ms / 1000),
    is_stream: Boolean(row.is_stream),
    channel: row.upstream_id ?? 0,
    channel_name: row.upstream_name,
    group: 'default',
    ip: row.ip,
    other: JSON.stringify({
      frt: row.first_token_ms,
      is_model_mapped: row.upstream_model !== '' && row.upstream_model !== row.alias,
      upstream_model_name: row.upstream_model,
      estimated: Boolean(row.estimated),
      status_code: row.status_code,
    }),
    request_id: row.request_id,
    upstream_request_id: '',
  }
}

/** 按 NewAPI /api/log 的查询参数拼 WHERE */
function logFilter(query: URLSearchParams) {
  const clauses: string[] = []
  const args: (string | number)[] = []
  const add = (clause: string, ...values: (string | number)[]) => {
    clauses.push(clause)
    args.push(...values)
  }
  const num = (k: string) => (query.get(k) ? Number(query.get(k)) : undefined)
  const str = (k: string) => query.get(k)?.trim() || undefined

  const start = num('start_timestamp')
  const end = num('end_timestamp')
  if (start) add('created_at >= ?', start)
  if (end) add('created_at <= ?', end)
  const type = num('type')
  if (type === LOG_TYPE.CONSUME) add(CHARGED)
  if (type === LOG_TYPE.ERROR) add(`NOT ${CHARGED}`)
  const upstream = num('channel')
  if (upstream) add('upstream_id = ?', upstream)
  const app = str('username')
  if (app) add('app_slug = ?', app)
  const token = str('token_name')
  if (token) add('token_name = ?', token)
  const alias = str('model_name')
  if (alias) add('alias LIKE ?', `%${alias}%`)
  const requestId = str('request_id')
  if (requestId) add('request_id = ?', requestId)

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', args }
}

route('GET', '/api/log', ({ query }) => {
  const { page, size, offset } = pageParams(query)
  const { where, args } = logFilter(query)
  const { total } = db().prepare(`SELECT COUNT(*) AS total FROM usage_logs ${where}`).get(...args) as {
    total: number
  }
  const rows = db()
    .prepare(`SELECT * FROM usage_logs ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, size, offset) as unknown as UsageRow[]
  return ok({ items: rows.map(toLog), total, page, page_size: size })
})

route('GET', '/api/log/stat', ({ query }) => {
  const { where, args } = logFilter(query)
  const { quota } = db()
    .prepare(`SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS quota FROM usage_logs ${where}`)
    .get(...args) as { quota: number }
  // 最近 60 秒的请求数和 token 数
  const recent = db()
    .prepare(
      `SELECT COUNT(*) AS rpm, COALESCE(SUM(input_tokens + output_tokens), 0) AS tpm FROM usage_logs WHERE created_at >= ?`
    )
    .get(Math.floor(Date.now() / 1000) - 60) as { rpm: number; tpm: number }
  return ok({ quota, rpm: recent.rpm, tpm: recent.tpm })
})

// ---------------------------------------------------------------------------
// 数据看板：成功请求按小时聚合（NewAPI 的 quota_data）
// ---------------------------------------------------------------------------

function rangeFilter(query: URLSearchParams) {
  const clauses = [CHARGED, 'created_at >= ?', 'created_at <= ?']
  const args: (string | number)[] = [
    Number(query.get('start_timestamp') ?? 0),
    Number(query.get('end_timestamp') ?? Number.MAX_SAFE_INTEGER),
  ]
  const app = query.get('username')
  if (app) {
    clauses.push('app_slug = ?')
    args.push(app)
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, args }
}

const SUMS = `SUM(input_tokens + output_tokens) AS token_used, COUNT(*) AS count, SUM(input_tokens + output_tokens) AS quota`
const HOUR = 'created_at - (created_at % 3600)'

function byModelHour(query: URLSearchParams) {
  const { where, args } = rangeFilter(query)
  return ok(
    db()
      .prepare(`SELECT alias AS model_name, ${HOUR} AS created_at, ${SUMS} FROM usage_logs ${where} GROUP BY 1, 2 ORDER BY 2`)
      .all(...args)
  )
}

route('GET', '/api/data', ({ query }) => byModelHour(query))
route('GET', '/api/data/self', ({ query }) => byModelHour(query))

route('GET', '/api/data/users', ({ query }) => {
  const { where, args } = rangeFilter(query)
  return ok(
    db()
      .prepare(
        `SELECT app_id AS user_id, app_slug AS username, ${HOUR} AS created_at, ${SUMS}
         FROM usage_logs ${where} GROUP BY 1, 2, 3 ORDER BY 3`
      )
      .all(...args)
  )
})

route('GET', '/api/data/flow', ({ query }) => {
  const { where, args } = rangeFilter(query)
  return ok(
    db()
      .prepare(
        `SELECT app_id AS user_id, app_slug AS username, token_id, token_name,
                upstream_id AS channel_id, upstream_name AS channel_name, alias AS model_name,
                'default' AS use_group, 'r4s' AS node_name, ${SUMS}
         FROM usage_logs ${where} GROUP BY app_id, app_slug, token_id, token_name, upstream_id, upstream_name, alias`
      )
      .all(...args)
  )
})
