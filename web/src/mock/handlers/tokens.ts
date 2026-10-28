import { tokens, users, type MockToken } from '../data'
import { fail, mock, ok, paginate } from '../router'

// 管理员视角：看所有应用的令牌（NewAPI 里只能看自己的，Conduit 只有管理员一个人用后台）
const mask = (t: MockToken) => ({
  ...t,
  key: `${t.key.slice(0, 4)}****${t.key.slice(-4)}`,
  app_name: users.find((u) => u.id === t.user_id)?.username ?? '',
})

mock('GET', '/api/token', ({ query }) => {
  const list = [...tokens].sort((a, b) => b.id - a.id).map(mask)
  return paginate(list, query)
})

mock('GET', '/api/token/search', ({ query }) => {
  const keyword = (query.get('keyword') ?? '').toLowerCase()
  const list = tokens
    .filter((t) => !keyword || t.name.toLowerCase().includes(keyword))
    .sort((a, b) => b.id - a.id)
    .map(mask)
  return paginate(list, query)
})

mock('GET', '/api/token/:id', ({ params }) => {
  const t = tokens.find((x) => x.id === Number(params.id))
  return t ? ok(mask(t)) : fail('令牌不存在')
})

mock('POST', '/api/token/:id/key', ({ params }) => {
  const t = tokens.find((x) => x.id === Number(params.id))
  return t ? ok({ key: t.key }) : fail('令牌不存在')
})

mock('POST', '/api/token/batch/keys', ({ body }) => {
  const ids = ((body as { ids?: number[] })?.ids ?? []).map(Number)
  return ok({ keys: Object.fromEntries(tokens.filter((t) => ids.includes(t.id)).map((t) => [t.id, t.key])) })
})

mock('POST', '/api/token', ({ body }) => {
  const input = (body ?? {}) as Partial<MockToken>
  if (!users.some((u) => u.id === Number(input.user_id) && u.role < 10)) {
    return fail('请选择应用')
  }
  const id = Math.max(0, ...tokens.map((t) => t.id)) + 1
  const t: MockToken = {
    id,
    user_id: Number(input.user_id),
    name: input.name ?? `token-${id}`,
    key: crypto.randomUUID().replaceAll('-', ''),
    status: 1,
    remain_quota: input.remain_quota ?? 0,
    used_quota: 0,
    unlimited_quota: input.unlimited_quota ?? false,
    expired_time: input.expired_time ?? -1,
    created_time: Math.floor(Date.now() / 1000),
    accessed_time: 0,
    group: input.group ?? 'default',
    model_limits_enabled: input.model_limits_enabled ?? false,
    model_limits: input.model_limits ?? '',
    allow_ips: input.allow_ips ?? '',
    cross_group_retry: false,
    allow_user_quota_query: false,
  }
  tokens.push(t)
  return ok(mask(t))
})

mock('PUT', '/api/token', ({ body, query }) => {
  const input = (body ?? {}) as Partial<MockToken> & { id?: number }
  const t = tokens.find((x) => x.id === Number(input.id))
  if (!t) return fail('令牌不存在')
  if (query.get('status_only')) {
    t.status = Number(input.status)
  } else {
    const { id: _id, key: _key, user_id: _uid, ...rest } = input
    Object.assign(t, rest)
  }
  return ok(mask(t))
})

mock('DELETE', '/api/token/:id', ({ params }) => {
  const i = tokens.findIndex((x) => x.id === Number(params.id))
  if (i < 0) return fail('令牌不存在')
  tokens.splice(i, 1)
  return ok()
})

mock('POST', '/api/token/batch', ({ body }) => {
  const ids = ((body as { ids?: number[] })?.ids ?? []).map(Number)
  const before = tokens.length
  for (const id of ids) {
    const i = tokens.findIndex((t) => t.id === id)
    if (i >= 0) tokens.splice(i, 1)
  }
  return ok(before - tokens.length)
})
