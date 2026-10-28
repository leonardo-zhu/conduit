/**
 * 假数据，按 Conduit 的实际场景编：应用（暂用 NewAPI 的"用户"表示）、
 * 设备令牌、三个上游（Ark / MiniMax / Nous）和别名。存在内存里，
 * 改动在 dev 服务重启后丢失。
 */

const now = () => Math.floor(Date.now() / 1000)
const DAY = 86400

// ---------------------------------------------------------------------------
// 应用（NewAPI 用户）。role: 1 普通用户，100 超级管理员；quota 单位是 token
// ---------------------------------------------------------------------------

export interface MockUser {
  id: number
  username: string
  display_name: string
  role: number
  status: number
  group: string
  quota: number
  used_quota: number
  request_count: number
  remark?: string
  created_at: number
  last_login_at: number
}

export const users: MockUser[] = [
  {
    id: 1,
    username: 'admin',
    display_name: 'Admin',
    role: 100,
    status: 1,
    group: 'default',
    quota: 0,
    used_quota: 0,
    request_count: 0,
    created_at: now() - 30 * DAY,
    last_login_at: now(),
  },
  {
    id: 2,
    username: 'vita',
    display_name: 'Vita',
    role: 1,
    status: 1,
    group: 'default',
    quota: 50_000_000,
    used_quota: 0,
    request_count: 0,
    remark: '第一个接入方',
    created_at: now() - 20 * DAY,
    last_login_at: 0,
  },
  {
    id: 3,
    username: 'svc-notes',
    display_name: 'Notes Service',
    role: 1,
    status: 1,
    group: 'default',
    quota: 10_000_000,
    used_quota: 0,
    request_count: 0,
    created_at: now() - 5 * DAY,
    last_login_at: 0,
  },
]

// ---------------------------------------------------------------------------
// 上游（NewAPI 渠道）。model_mapping 就是"别名 → 上游模型"
// ---------------------------------------------------------------------------

export interface MockChannel {
  id: number
  type: number
  name: string
  base_url: string
  key: string
  status: number
  models: string
  model_mapping: string
  group: string
  priority: number
  weight: number
  auto_ban: number
  created_time: number
  test_time: number
  response_time: number
  balance: number
  balance_updated_time: number
  used_quota: number
  remark: string
  tag: string | null
}

const aliasMap = {
  ark: { 'vita-chat': 'doubao-seed-1-6-251015', 'vita-vision': 'doubao-seed-1-6-vision-250815' },
  minimax: { 'vita-fast': 'MiniMax-M2' },
  nous: { 'notes-summary': 'Hermes-4-70B' },
}

export const channels: MockChannel[] = [
  {
    id: 1,
    type: 8, // Custom：Ark Agent Plan 的地址 NewAPI 的火山渠道不认识
    name: 'Ark Agent Plan',
    base_url: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    key: 'ark-****',
    status: 1,
    models: Object.keys(aliasMap.ark).join(','),
    model_mapping: JSON.stringify(aliasMap.ark),
    group: 'default',
    priority: 0,
    weight: 0,
    auto_ban: 1,
    created_time: now() - 20 * DAY,
    test_time: now() - 3600,
    response_time: 820,
    balance: 0,
    balance_updated_time: 0,
    used_quota: 0,
    remark: '订阅制套餐',
    tag: null,
  },
  {
    id: 2,
    type: 1, // OpenAI 兼容，经 adapter 转换协议
    name: 'MiniMax',
    base_url: 'http://127.0.0.1:3011/minimax',
    key: 'mm-****',
    status: 1,
    models: Object.keys(aliasMap.minimax).join(','),
    model_mapping: JSON.stringify(aliasMap.minimax),
    group: 'default',
    priority: 0,
    weight: 0,
    auto_ban: 1,
    created_time: now() - 15 * DAY,
    test_time: now() - 7200,
    response_time: 1240,
    balance: 0,
    balance_updated_time: 0,
    used_quota: 0,
    remark: '',
    tag: null,
  },
  {
    id: 3,
    type: 1,
    name: 'Nous',
    base_url: 'http://127.0.0.1:3011/nous',
    key: 'nous-****',
    status: 2, // 自动禁用，演示异常状态
    models: Object.keys(aliasMap.nous).join(','),
    model_mapping: JSON.stringify(aliasMap.nous),
    group: 'default',
    priority: 0,
    weight: 0,
    auto_ban: 1,
    created_time: now() - 10 * DAY,
    test_time: now() - 86400,
    response_time: 0,
    balance: 0,
    balance_updated_time: 0,
    used_quota: 0,
    remark: '',
    tag: null,
  },
]

export const aliasToChannel: Record<string, { channel: MockChannel; upstream: string }> = {}
for (const [name, mapping] of Object.entries(aliasMap)) {
  const channel = channels.find((c) => c.name.toLowerCase().startsWith(name))!
  for (const [alias, upstream] of Object.entries(mapping)) {
    aliasToChannel[alias] = { channel, upstream }
  }
}

// ---------------------------------------------------------------------------
// 令牌。status: 1 启用，2 禁用，3 过期，4 额度用尽
// ---------------------------------------------------------------------------

export interface MockToken {
  id: number
  user_id: number
  name: string
  key: string
  status: number
  remain_quota: number
  used_quota: number
  unlimited_quota: boolean
  expired_time: number
  created_time: number
  accessed_time: number
  group: string
  model_limits_enabled: boolean
  model_limits: string
  allow_ips: string
  cross_group_retry: boolean
  allow_user_quota_query: boolean
}

function fakeKey(seed: number) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let s = ''
  let x = seed * 2654435761
  for (let i = 0; i < 48; i++) {
    x = (x * 1103515245 + 12345) >>> 0
    s += chars[x % chars.length]
  }
  return s
}

function token(
  id: number,
  userId: number,
  name: string,
  models: string[],
  extra: Partial<MockToken> = {}
): MockToken {
  return {
    id,
    user_id: userId,
    name,
    key: fakeKey(id),
    status: 1,
    remain_quota: 5_000_000,
    used_quota: 0,
    unlimited_quota: false,
    expired_time: now() + 60 * DAY,
    created_time: now() - (20 - id) * DAY,
    accessed_time: 0,
    group: 'default',
    model_limits_enabled: models.length > 0,
    model_limits: models.join(','),
    allow_ips: '',
    cross_group_retry: false,
    allow_user_quota_query: false,
    ...extra,
  }
}

export const tokens: MockToken[] = [
  token(1, 2, 'vita-leonardo-iphone', ['vita-chat', 'vita-vision', 'vita-fast']),
  token(2, 2, 'vita-leonardo-ipad', ['vita-chat', 'vita-vision', 'vita-fast']),
  token(3, 2, 'vita-dev-simulator', ['vita-chat', 'vita-fast'], {
    remain_quota: 500_000,
    expired_time: now() + 7 * DAY,
  }),
  token(4, 2, 'vita-old-iphone', ['vita-chat'], { status: 2 }),
  token(5, 3, 'notes-server', ['notes-summary'], { unlimited_quota: true, expired_time: -1 }),
  token(6, 3, 'notes-test', ['notes-summary'], { status: 3, expired_time: now() - 2 * DAY }),
]

// ---------------------------------------------------------------------------
// 用量日志：最近 7 天，固定种子生成，每次启动一样
// ---------------------------------------------------------------------------

export interface MockLog {
  id: number
  user_id: number
  created_at: number
  type: number
  content: string
  username: string
  token_name: string
  token_id: number
  model_name: string
  quota: number
  prompt_tokens: number
  completion_tokens: number
  use_time: number
  is_stream: boolean
  channel: number
  channel_name: string
  group: string
  ip: string
  other: string
  request_id: string
  upstream_request_id: string
}

function prng(seed: number) {
  let x = seed
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0
    return x / 2 ** 32
  }
}

function generateLogs(): MockLog[] {
  const rand = prng(42)
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)]
  // 已禁用、已过期的令牌不会产生新请求
  const active = tokens.filter((t) => t.status === 1)
  const logs: MockLog[] = []
  const start = now() - 7 * DAY

  for (let i = 0; i < 420; i++) {
    const t = pick(active)
    const alias = pick(t.model_limits.split(','))
    const route = aliasToChannel[alias]
    const user = users.find((u) => u.id === t.user_id)!
    const isError = route.channel.status !== 1 ? rand() < 0.6 : rand() < 0.04
    const prompt = Math.floor(800 + rand() * 6000)
    const completion = isError ? 0 : Math.floor(50 + rand() * 1500)
    const useTime = isError ? Math.floor(1 + rand() * 4) : Math.floor(2 + rand() * 25)
    logs.push({
      id: i + 1,
      user_id: user.id,
      created_at: start + Math.floor(rand() * 7 * DAY),
      type: isError ? 5 : 2,
      content: isError ? 'upstream error: status code 502' : '',
      username: user.username,
      token_name: t.name,
      token_id: t.id,
      model_name: alias,
      quota: isError ? 0 : prompt + completion,
      prompt_tokens: isError ? 0 : prompt,
      completion_tokens: completion,
      use_time: useTime,
      is_stream: rand() < 0.85,
      channel: route.channel.id,
      channel_name: route.channel.name,
      group: 'default',
      ip: '',
      other: JSON.stringify({
        frt: Math.floor(300 + rand() * 1500),
        is_model_mapped: true,
        upstream_model_name: route.upstream,
      }),
      request_id: `req_${(i + 1).toString(36).padStart(6, '0')}`,
      upstream_request_id: '',
    })
  }
  logs.sort((a, b) => b.created_at - a.created_at)

  // 回填各表的累计用量
  for (const log of logs) {
    if (log.type !== 2) continue
    tokens.find((t) => t.id === log.token_id)!.used_quota += log.quota
    const user = users.find((u) => u.id === log.user_id)!
    user.used_quota += log.quota
    user.request_count += 1
    channels.find((c) => c.id === log.channel)!.used_quota += log.quota
  }
  for (const t of tokens) {
    const last = logs.find((l) => l.token_id === t.id)
    if (last) t.accessed_time = last.created_at
  }
  return logs
}

export const logs: MockLog[] = generateLogs()
