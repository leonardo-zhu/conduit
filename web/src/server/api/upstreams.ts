/**
 * 上游：模型服务商的一个接入点（地址 + 密钥）。后台沿用 NewAPI 的“渠道”接口（/api/channel），
 * 返回 NewAPI 渠道的格式；models 是上游提供的模型名，别名在应用下配置（见 apps.ts）。
 *
 * 密钥用 CONDUIT_MASTER_KEY 加密后存库，接口只返回末四位。
 */
import { decryptSecret, encryptSecret } from '../crypto'
import {
  db,
  isForeignKeyViolation,
  nowSeconds,
  parseJsonArray,
  transaction,
} from '../db'
import { fail, ok, pageParams, type ApiRequest } from '../router'
import { route } from './registry'

export interface UpstreamRow {
  id: number
  name: string
  type: number
  base_url: string
  key_enc: string
  key_last4: string
  models: string
  test_model: string
  status: number
  remark: string
  created_at: number
  test_time: number
  response_time: number
  /** responses：原生 Responses API，直接透传；chat：只支持 Chat Completions，由网关转换 */
  protocol: UpstreamProtocol
}

export type UpstreamProtocol = 'responses' | 'chat'
const PROTOCOLS = new Set<UpstreamProtocol>(['responses', 'chat'])

/** Conduit 支持的类型：1 OpenAI 兼容，8 自定义，45 火山方舟，35 MiniMax */
const UPSTREAM_TYPES = new Set([1, 8, 45, 35])
const UPSTREAM_STATUS = { ENABLED: 1, DISABLED: 2 } as const
const TEST_TIMEOUT_MS = 20_000

export function getUpstream(id: number): UpstreamRow | undefined {
  return db().prepare('SELECT * FROM upstreams WHERE id = ?').get(id) as UpstreamRow | undefined
}

export function upstreamKey(upstream: UpstreamRow): string {
  return decryptSecret(upstream.key_enc)
}

function usedTokens(): Map<number, number> {
  const rows = db()
    .prepare(
      'SELECT upstream_id, SUM(input_tokens + output_tokens) AS used FROM usage_logs WHERE upstream_id IS NOT NULL GROUP BY upstream_id'
    )
    .all() as { upstream_id: number; used: number }[]
  return new Map(rows.map((r) => [r.upstream_id, r.used]))
}

/** 转成 NewAPI 渠道的格式，NewAPI 独有的字段给默认值 */
function toChannel(row: UpstreamRow, used = 0) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    base_url: row.base_url,
    key: '',
    key_last4: row.key_last4,
    status: row.status,
    models: parseJsonArray(row.models).join(','),
    protocol: row.protocol,
    model_mapping: '',
    test_model: row.test_model || null,
    group: 'default',
    priority: 0,
    weight: 0,
    auto_ban: 0,
    created_time: row.created_at,
    test_time: row.test_time,
    response_time: row.response_time,
    balance: 0,
    balance_updated_time: 0,
    used_quota: used,
    remark: row.remark,
    tag: null,
    other: '',
    other_info: '',
    setting: null,
    settings: '{}',
    param_override: null,
    header_override: null,
    status_code_mapping: null,
    openai_organization: null,
    max_input_tokens: 0,
    channel_info: { is_multi_key: false, multi_key_size: 0, multi_key_polling_index: 0, multi_key_mode: 'random' },
  }
}

function listUpstreams(query: URLSearchParams) {
  const { page, size, offset } = pageParams(query, 20)
  const keyword = (query.get('keyword') ?? '').trim()
  const where = keyword ? 'WHERE name LIKE ? OR models LIKE ?' : ''
  const args = keyword ? [`%${keyword}%`, `%${keyword}%`] : []
  const rows = db()
    .prepare(`SELECT * FROM upstreams ${where} ORDER BY id`)
    .all(...args) as unknown as UpstreamRow[]
  const typeCounts: Record<string, number> = {}
  for (const r of rows) typeCounts[r.type] = (typeCounts[r.type] ?? 0) + 1
  const used = usedTokens()
  return ok({
    items: rows.slice(offset, offset + size).map((r) => toChannel(r, used.get(r.id))),
    total: rows.length,
    page,
    page_size: size,
    type_counts: typeCounts,
  })
}

interface ChannelInput {
  name?: unknown
  type?: unknown
  base_url?: unknown
  key?: unknown
  models?: unknown
  test_model?: unknown
  status?: unknown
  remark?: unknown
  protocol?: unknown
}

function readUpstreamInput(body: unknown, partial: boolean) {
  const input = (body ?? {}) as ChannelInput
  const fields: Record<string, string | number> = {}
  const has = (k: keyof ChannelInput) => !partial || input[k] !== undefined

  if (has('name')) {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name) return { error: '请填写名称' }
    fields.name = name
  }
  if (has('type')) {
    const type = Number(input.type)
    if (!UPSTREAM_TYPES.has(type)) return { error: '不支持的上游类型' }
    fields.type = type
  }
  if (has('base_url')) {
    const baseUrl = typeof input.base_url === 'string' ? input.base_url.trim().replace(/\/+$/, '') : ''
    if (!/^https?:\/\/\S+$/.test(baseUrl)) return { error: '请填写上游地址（http:// 或 https:// 开头）' }
    fields.base_url = baseUrl
  }
  // 编辑时 key 留空表示不改
  const key = typeof input.key === 'string' ? input.key.trim() : ''
  if (key) {
    fields.key_enc = encryptSecret(key)
    fields.key_last4 = key.slice(-4)
  } else if (!partial) {
    return { error: '请填写密钥' }
  }
  if (has('models')) {
    const models = typeof input.models === 'string' ? input.models.split(',') : []
    fields.models = JSON.stringify([...new Set(models.map((m) => m.trim()).filter(Boolean))])
  }
  if (has('test_model')) fields.test_model = typeof input.test_model === 'string' ? input.test_model.trim() : ''
  if (has('status')) {
    // 新建时没传状态默认启用
    const status = input.status === undefined ? UPSTREAM_STATUS.ENABLED : Number(input.status)
    fields.status = status === UPSTREAM_STATUS.ENABLED ? UPSTREAM_STATUS.ENABLED : UPSTREAM_STATUS.DISABLED
  }
  if (has('remark')) fields.remark = typeof input.remark === 'string' ? input.remark.slice(0, 255) : ''
  if (has('protocol')) {
    // 新建时没传：火山方舟默认原生 Responses，其余默认 Chat
    const protocol = input.protocol ?? (fields.type === 45 ? 'responses' : 'chat')
    if (!PROTOCOLS.has(protocol as UpstreamProtocol)) return { error: '协议只能是 responses 或 chat' }
    fields.protocol = protocol as string
  }
  return { fields }
}

function insertUpstream(fields: Record<string, string | number>): number {
  const columns = Object.keys(fields)
  const result = db()
    .prepare(
      `INSERT INTO upstreams (${columns.join(', ')}, created_at) VALUES (${columns.map(() => '?').join(', ')}, ?)`
    )
    .run(...Object.values(fields), nowSeconds())
  return Number(result.lastInsertRowid)
}

function updateUpstream(id: number, fields: Record<string, string | number>) {
  const entries = Object.entries(fields)
  if (!entries.length) return
  db()
    .prepare(`UPDATE upstreams SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id)
}

function deleteUpstreams(ids: number[]): { deleted: number } | { error: string } {
  try {
    return transaction(() => {
      let deleted = 0
      for (const id of ids) deleted += Number(db().prepare('DELETE FROM upstreams WHERE id = ?').run(id).changes)
      return { deleted }
    })
  } catch (e) {
    if (isForeignKeyViolation(e)) return { error: '还有应用的别名指向这个上游，先在应用里改掉这些别名' }
    throw e
  }
}

route('GET', '/api/channel', ({ query }) => listUpstreams(query))
route('GET', '/api/channel/search', ({ query }) => listUpstreams(query))

route('GET', '/api/channel/:id', ({ params }) => {
  const row = getUpstream(Number(params.id))
  return row ? ok(toChannel(row, usedTokens().get(row.id))) : fail('上游不存在')
})

route('POST', '/api/channel', ({ body }) => {
  // NewAPI 前端提交 { mode: 'single', channel: {...} }
  const input = (body as { channel?: unknown })?.channel ?? body
  const { fields, error } = readUpstreamInput(input, false)
  if (error || !fields) return fail(error ?? '参数错误')
  const id = insertUpstream(fields)
  return ok(toChannel(getUpstream(id)!))
})

route('PUT', '/api/channel', ({ body }) => {
  const id = Number((body as { id?: unknown })?.id)
  if (!getUpstream(id)) return fail('上游不存在')
  const { fields, error } = readUpstreamInput(body, true)
  if (error || !fields) return fail(error ?? '参数错误')
  updateUpstream(id, fields)
  return ok(toChannel(getUpstream(id)!))
})

route('POST', '/api/channel/:id/status', ({ params, body }) => {
  const row = getUpstream(Number(params.id))
  if (!row) return fail('上游不存在')
  const status = Number((body as { status?: unknown })?.status) === UPSTREAM_STATUS.ENABLED ? 1 : 2
  updateUpstream(row.id, { status })
  return ok(true)
})

route('POST', '/api/channel/status/batch', ({ body }) => {
  const { ids, status } = (body ?? {}) as { ids?: unknown; status?: unknown }
  if (!Array.isArray(ids)) return fail('参数错误')
  const value = Number(status) === UPSTREAM_STATUS.ENABLED ? 1 : 2
  for (const id of ids) updateUpstream(Number(id), { status: value })
  return ok(ids.length)
})

route('DELETE', '/api/channel/:id', ({ params }) => {
  const result = deleteUpstreams([Number(params.id)])
  if ('error' in result) return fail(result.error)
  return result.deleted ? ok() : fail('上游不存在')
})

route('POST', '/api/channel/batch', ({ body }) => {
  const ids = (body as { ids?: unknown })?.ids
  if (!Array.isArray(ids)) return fail('参数错误')
  const result = deleteUpstreams(ids.map(Number))
  return 'error' in result ? fail(result.error) : ok(result.deleted)
})

// 复制：密钥一并复制（仍是加密的），名称加后缀
route('POST', '/api/channel/copy/:id', ({ params, query }) => {
  const row = getUpstream(Number(params.id))
  if (!row) return fail('上游不存在')
  const { id: _id, created_at: _c, test_time: _t, response_time: _r, ...rest } = row
  const id = insertUpstream({ ...rest, name: `${row.name}${query.get('suffix') ?? '_复制'}` })
  return ok({ id })
})

// ---------------------------------------------------------------------------
// 连接上游：测试、拉取模型列表
// ---------------------------------------------------------------------------

async function callUpstream(row: UpstreamRow, path: string, init: RequestInit = {}) {
  return fetch(`${row.base_url}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${upstreamKey(row)}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
  })
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return '请求上游超时'
  return error instanceof Error ? error.message : String(error)
}

// 测试：用测试模型发一个 max_tokens=1 的 Chat Completions 请求
route('GET', '/api/channel/test/:id', async ({ params, query }: ApiRequest) => {
  const row = getUpstream(Number(params.id))
  if (!row) return fail('上游不存在')
  const model = query.get('model') || row.test_model || parseJsonArray(row.models)[0]
  if (!model) return fail('没有可测试的模型：先在上游里填模型列表或测试模型')

  const started = Date.now()
  try {
    const res = await callUpstream(row, '/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
    })
    const elapsed = Date.now() - started
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300)
      return fail(`上游返回 ${res.status}：${text}`)
    }
    updateUpstream(row.id, { test_time: nowSeconds(), response_time: elapsed })
    // NewAPI 的测试接口把耗时（秒）放在顶层 time 字段
    return { body: { success: true, message: '', time: elapsed / 1000 } }
  } catch (error) {
    return fail(`连接上游失败：${describeError(error)}`)
  }
})

// 拉取上游的模型列表（OpenAI 兼容的 GET /models）
route('GET', '/api/channel/fetch_models/:id', async ({ params }: ApiRequest) => {
  const row = getUpstream(Number(params.id))
  if (!row) return fail('上游不存在')
  try {
    const res = await callUpstream(row, '/models')
    if (!res.ok) return fail(`上游返回 ${res.status}，这个上游可能不支持列出模型`)
    const json = (await res.json()) as { data?: { id?: unknown }[] }
    const ids = (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string')
    return ok(ids.sort())
  } catch (error) {
    return fail(`连接上游失败：${describeError(error)}`)
  }
})

// 所有应用的别名名（日志、看板的模型筛选用）
route('GET', '/api/channel/models', () => {
  const rows = db().prepare('SELECT DISTINCT name FROM aliases ORDER BY name').all() as { name: string }[]
  return ok(rows.map((r) => ({ id: r.name, object: 'model', owned_by: 'conduit' })))
})

route('GET', '/api/channel/models_enabled', () => {
  const rows = db()
    .prepare(
      'SELECT DISTINCT a.name FROM aliases a JOIN upstreams u ON u.id = a.upstream_id WHERE u.status = 1 ORDER BY a.name'
    )
    .all() as { name: string }[]
  return ok(rows.map((r) => r.name))
})

route('GET', '/api/channel/default_base_urls', () =>
  ok({ 1: 'https://api.openai.com/v1', 45: 'https://ark.cn-beijing.volces.com/api/v3' })
)
