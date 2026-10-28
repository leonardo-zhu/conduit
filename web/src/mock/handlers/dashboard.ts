import { logs, tokens } from '../data'
import { mock, ok, type MockRequest } from '../router'

// 仪表盘统计：NewAPI 按小时聚合的 quota_data，这里从假日志现算
function inRange({ query }: MockRequest) {
  const start = Number(query.get('start_timestamp') ?? 0)
  const end = Number(query.get('end_timestamp') ?? Number.MAX_SAFE_INTEGER)
  const username = query.get('username') || undefined
  return logs.filter(
    (l) =>
      l.type === 2 &&
      l.created_at >= start &&
      l.created_at <= end &&
      (!username || l.username === username)
  )
}

function aggregate<K extends string>(
  list: typeof logs,
  keyOf: (l: (typeof logs)[number]) => Record<K, string | number>
) {
  const groups = new Map<string, Record<string, unknown> & { token_used: number; count: number; quota: number }>()
  for (const l of list) {
    const key = keyOf(l)
    const id = JSON.stringify(key)
    const g = groups.get(id) ?? { ...key, token_used: 0, count: 0, quota: 0 }
    g.token_used += l.prompt_tokens + l.completion_tokens
    g.count += 1
    g.quota += l.quota
    groups.set(id, g)
  }
  return [...groups.values()]
}

const hour = (t: number) => t - (t % 3600)

const byModelHour = (req: MockRequest) =>
  ok(aggregate(inRange(req), (l) => ({ model_name: l.model_name, created_at: hour(l.created_at) })))

mock('GET', '/api/data', byModelHour)
mock('GET', '/api/data/self', byModelHour)

mock('GET', '/api/data/users', (req) =>
  ok(
    aggregate(inRange(req), (l) => ({
      user_id: l.user_id,
      username: l.username,
      created_at: hour(l.created_at),
    }))
  )
)

mock('GET', '/api/data/flow', (req) =>
  ok(
    aggregate(inRange(req), (l) => ({
      user_id: l.user_id,
      username: l.username,
      token_id: l.token_id,
      token_name: l.token_name,
      channel_id: l.channel,
      channel_name: l.channel_name,
      model_name: l.model_name,
      use_group: l.group,
      node_name: 'r4s',
    }))
  )
)

// 可用模型 = 所有令牌白名单里出现过的别名
mock('GET', '/api/user/models', () =>
  ok([...new Set(tokens.flatMap((t) => t.model_limits.split(',').filter(Boolean)))].sort())
)
