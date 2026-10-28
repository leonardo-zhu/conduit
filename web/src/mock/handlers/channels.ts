import { channels, type MockChannel } from '../data'
import { fail, mock, ok, type MockRequest } from '../router'

const withDefaults = (c: MockChannel) => ({
  ...c,
  key: '',
  other: '',
  other_info: '',
  setting: null,
  settings: '{}',
  param_override: null,
  header_override: null,
  status_code_mapping: null,
  test_model: null,
  openai_organization: null,
  max_input_tokens: 0,
  channel_info: {
    is_multi_key: false,
    multi_key_size: 0,
    multi_key_polling_index: 0,
    multi_key_mode: 'random',
  },
})

function list({ query }: MockRequest, keyword = '') {
  const page = Math.max(1, Number(query.get('p') ?? 1) || 1)
  const size = Math.max(1, Number(query.get('page_size') ?? 20) || 20)
  const filtered = channels.filter(
    (c) =>
      !keyword ||
      c.name.toLowerCase().includes(keyword) ||
      c.models.toLowerCase().includes(keyword)
  )
  const typeCounts: Record<string, number> = {}
  for (const c of filtered) typeCounts[c.type] = (typeCounts[c.type] ?? 0) + 1
  return ok({
    items: filtered.slice((page - 1) * size, page * size).map(withDefaults),
    total: filtered.length,
    page,
    page_size: size,
    type_counts: typeCounts,
  })
}

mock('GET', '/api/channel', (req) => list(req))
mock('GET', '/api/channel/search', (req) => list(req, (req.query.get('keyword') ?? '').toLowerCase()))

mock('GET', '/api/channel/ops', () =>
  ok({ retry_times: 0, request_policy: { automatic_disable: true, source: 'global' } })
)

mock('GET', '/api/channel/models', () =>
  ok(
    [...new Set(channels.flatMap((c) => c.models.split(',')))].map((id) => ({
      id,
      object: 'model',
      owned_by: 'conduit',
    }))
  )
)

mock('GET', '/api/channel/models_enabled', () =>
  ok([...new Set(channels.filter((c) => c.status === 1).flatMap((c) => c.models.split(',')))])
)

mock('GET', '/api/channel/:id', ({ params }) => {
  const c = channels.find((x) => x.id === Number(params.id))
  return c ? ok(withDefaults(c)) : fail('渠道不存在')
})

mock('PUT', '/api/channel', ({ body }) => {
  const input = (body ?? {}) as Partial<MockChannel> & { id?: number }
  const c = channels.find((x) => x.id === Number(input.id))
  if (!c) return fail('渠道不存在')
  const { id: _id, key, ...rest } = input
  Object.assign(c, rest)
  if (key) c.key = `${String(key).slice(0, 3)}-****`
  return ok(withDefaults(c))
})

mock('POST', '/api/channel', ({ body }) => {
  const input = ((body as { channel?: Partial<MockChannel> })?.channel ?? body ?? {}) as Partial<MockChannel>
  const id = Math.max(0, ...channels.map((c) => c.id)) + 1
  const t = Math.floor(Date.now() / 1000)
  channels.push({
    id,
    type: input.type ?? 1,
    name: input.name ?? `channel-${id}`,
    base_url: input.base_url ?? '',
    key: '****',
    status: 1,
    models: input.models ?? '',
    model_mapping: input.model_mapping ?? '',
    group: input.group ?? 'default',
    priority: 0,
    weight: 0,
    auto_ban: 1,
    created_time: t,
    test_time: 0,
    response_time: 0,
    balance: 0,
    balance_updated_time: 0,
    used_quota: 0,
    remark: input.remark ?? '',
    tag: null,
  })
  return ok()
})

mock('DELETE', '/api/channel/:id', ({ params }) => {
  const i = channels.findIndex((x) => x.id === Number(params.id))
  if (i < 0) return fail('渠道不存在')
  channels.splice(i, 1)
  return ok()
})

// 测试渠道：按渠道状态给个结果，不真的请求上游
mock('GET', '/api/channel/test/:id', ({ params }) => {
  const c = channels.find((x) => x.id === Number(params.id))
  if (!c) return fail('渠道不存在')
  if (c.status !== 1) return fail('upstream error: status code 502')
  c.test_time = Math.floor(Date.now() / 1000)
  // NewAPI 的测试接口把耗时（秒）放在顶层 time 字段
  return { body: { success: true, message: '', time: c.response_time / 1000 } }
})
