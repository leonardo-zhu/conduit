#!/usr/bin/env node
/**
 * 本地开发用的示例数据：两个应用（vita、svc-notes）、三个上游（密钥是假的）、别名、
 * 六个令牌和最近 7 天的用量记录。应用、上游、令牌走管理接口创建，用量记录直接写库。
 *
 * 库里已经有 vita 应用时不做任何事。不要对生产环境运行。
 *
 *   pnpm dev   # 另开一个终端
 *   node scripts/seed-dev.mjs [http://localhost:3020] [密码]
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:3020'
const USERNAME = process.env.ADMIN_USERNAME || 'admin'
const PASSWORD = process.argv[3] || 'conduit-dev-local'
const db = new DatabaseSync(path.resolve(process.env.CONDUIT_DATA_DIR || '.data', 'conduit.db'))

if (db.prepare("SELECT 1 FROM apps WHERE slug = 'vita'").get()) {
  console.log('已有 vita 应用，跳过')
  process.exit(0)
}

let cookie = ''
async function call(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const session = res.headers.getSetCookie().find((c) => c.startsWith('conduit_session='))
  if (session) cookie = session.split(';')[0]
  const json = await res.json()
  if (!json.success) throw new Error(`${method} ${p}: ${json.message}`)
  return json.data
}

await call('POST', '/api/user/login', { username: USERNAME, password: PASSWORD })

const ark = await call('POST', '/api/channel', {
  channel: {
    name: 'Ark Agent Plan',
    slug: 'ark',
    responses_mode: 'native',
    base_url: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    key: 'fake-ark-key-0000',
    models: 'doubao-seed-1-6-251015,doubao-seed-1-6-vision-250815',
  },
})
const minimax = await call('POST', '/api/channel', {
  channel: { name: 'MiniMax', slug: 'minimax', responses_mode: 'convert', base_url: 'https://api.minimaxi.com/v1', key: 'fake-minimax-key-0000', models: 'MiniMax-M2' },
})
const nous = await call('POST', '/api/channel', {
  channel: {
    name: 'Nous',
    slug: 'nous',
    responses_mode: 'convert',
    base_url: 'https://inference-api.nousresearch.com/v1',
    key: 'fake-nous-key-0000',
    models: 'Hermes-4-70B',
    remark: '示例：已停用',
  },
})
await call('POST', `/api/channel/${nous.id}/status`, { status: 2 })

const vita = await call('POST', '/api/user', { username: 'vita', display_name: 'Vita', quota: 50_000_000, quota_period: 'month', remark: '第一个接入方' })
const notes = await call('POST', '/api/user', { username: 'svc-notes', display_name: 'Notes Service', quota: 10_000_000 })

await call('PUT', `/api/app/${vita.id}/aliases`, {
  aliases: [
    { name: 'vita-chat', upstream_id: ark.id, upstream_model: 'doubao-seed-1-6-251015' },
    { name: 'vita-vision', upstream_id: ark.id, upstream_model: 'doubao-seed-1-6-vision-250815' },
    { name: 'vita-fast', upstream_id: minimax.id, upstream_model: 'MiniMax-M2' },
  ],
})
await call('PUT', `/api/app/${notes.id}/aliases`, {
  aliases: [{ name: 'notes-summary', upstream_id: nous.id, upstream_model: 'Hermes-4-70B' }],
})

const DAY = 86400
const now = Math.floor(Date.now() / 1000)
// models 只决定示例用量记录里这个令牌调了哪些别名；令牌本身能用应用的全部别名
const token = async (app, name, models, extra = {}) => ({
  ...(await call('POST', '/api/token', { user_id: app.id, name, expired_time: now + 60 * DAY, ...extra })),
  models,
})

const tokens = [
  await token(vita, 'vita-leonardo-iphone', ['vita-chat', 'vita-vision', 'vita-fast']),
  await token(vita, 'vita-leonardo-ipad', ['vita-chat', 'vita-vision', 'vita-fast']),
  await token(vita, 'vita-dev-simulator', ['vita-chat', 'vita-fast'], { expired_time: now + 7 * DAY }),
  await token(notes, 'notes-server', ['notes-summary'], { expired_time: -1 }),
]
const old = await token(vita, 'vita-old-iphone', ['vita-chat'])
await call('PUT', '/api/token/?status_only=true', { id: old.id, status: 2 })
await token(notes, 'notes-test', ['notes-summary'], { expired_time: now - 2 * DAY })

// 用量记录：固定种子，每次生成一样
let seed = 42
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 2 ** 32)
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const aliasTarget = {
  'vita-chat': [ark, 'doubao-seed-1-6-251015'],
  'vita-vision': [ark, 'doubao-seed-1-6-vision-250815'],
  'vita-fast': [minimax, 'MiniMax-M2'],
  'notes-summary': [nous, 'Hermes-4-70B'],
}
const insert = db.prepare(
  `INSERT INTO usage_logs (request_id, app_id, app_slug, token_id, token_name, alias, upstream_id, upstream_name,
     upstream_model, input_tokens, output_tokens, is_stream, status_code, error, first_token_ms, duration_ms, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
)
const used = new Map()
db.exec('BEGIN')
for (let i = 0; i < 420; i++) {
  const t = pick(tokens)
  const alias = pick(t.models)
  const [upstream, model] = aliasTarget[alias]
  const failed = upstream.id === nous.id ? rand() < 0.6 : rand() < 0.04
  const input = failed ? 0 : Math.floor(800 + rand() * 6000)
  const output = failed ? 0 : Math.floor(50 + rand() * 1500)
  insert.run(
    `req_${(i + 1).toString(36).padStart(6, '0')}`,
    t.user_id, t.app_name, t.id, t.name, alias, upstream.id, upstream.name, model,
    input, output, rand() < 0.85 ? 1 : 0, failed ? 502 : 200, failed ? 'upstream error: status code 502' : '',
    failed ? 0 : Math.floor(300 + rand() * 1500), Math.floor((failed ? 1 : 2) + rand() * 25) * 1000,
    now - 7 * DAY + Math.floor(rand() * 7 * DAY)
  )
  if (!failed) {
    const u = used.get(t.id) ?? { app: t.user_id, tokens: 0, requests: 0 }
    u.tokens += input + output
    u.requests += 1
    used.set(t.id, u)
  }
}
// 回填令牌和应用的已用量
for (const [tokenId, u] of used) {
  db.prepare('UPDATE tokens SET used = ?, last_used_at = ? WHERE id = ?').run(u.tokens, now - Math.floor(rand() * 3600), tokenId)
  db.prepare('UPDATE apps SET used = used + ?, request_count = request_count + ? WHERE id = ?').run(u.tokens, u.requests, u.app)
}
db.exec('COMMIT')

console.log('已写入示例数据：2 个应用、3 个上游、4 个别名、6 个令牌、420 条用量记录')
