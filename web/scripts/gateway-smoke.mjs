#!/usr/bin/env node
/**
 * 网关数据面的冒烟测试：/v1/responses、/v1/chat/completions、/v1/models，
 * 用 scripts/mock-upstream.mjs 当上游。重点是阶段 3 的验证清单：
 * 流式用量是否准确、调用方中途断开时是否多扣、同一令牌并发时额度是否正确。
 *
 * 建的数据都以 smoke-gw 开头，结束时删掉。
 *
 *   pnpm dev                              # 一个终端
 *   node scripts/mock-upstream.mjs        # 另一个终端
 *   node scripts/gateway-smoke.mjs [http://localhost:3020] [密码]
 *   MOCK_UPSTREAM_URL=http://host.docker.internal:3099 node scripts/gateway-smoke.mjs http://localhost:3031   # 网关在容器里
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:3020'
const PASSWORD = process.argv[3] || 'conduit-dev-local'
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:3099'
// 网关访问假上游用的地址；网关跑在容器里时设成 http://host.docker.internal:3099
const MOCK_FOR_GATEWAY = process.env.MOCK_UPSTREAM_URL || MOCK
const db = new DatabaseSync(path.resolve(process.env.CONDUIT_DATA_DIR || '.data', 'conduit.db'))
db.exec('PRAGMA foreign_keys = ON')

let cookie = ''
async function admin(method, p, body) {
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

const gw = (p, key, body, headers = {}) =>
  fetch(BASE + p, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer sk-${key}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

/** 读完一个 SSE 响应，返回事件列表（data 解析成 JSON） */
async function readEvents(res) {
  const text = await res.text()
  return text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter((d) => d !== '[DONE]')
    .map((d) => JSON.parse(d))
}

const lastLog = (requestId) => db.prepare('SELECT * FROM usage_logs WHERE request_id = ?').get(requestId)
const tokenUsed = (id) => db.prepare('SELECT used FROM tokens WHERE id = ?').get(id).used
const mockLast = async () => (await fetch(`${MOCK}/_last`)).json()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failed = 0
function check(label, okay, detail) {
  console.log(`${okay ? '✓' : '✗'} ${label}${okay ? '' : `  ${JSON.stringify(detail)?.slice(0, 400)}`}`)
  if (!okay) failed += 1
}

try {
  await fetch(`${MOCK}/_stats`)
} catch {
  console.error('先运行 node scripts/mock-upstream.mjs')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 准备
// ---------------------------------------------------------------------------

db.exec("DELETE FROM apps WHERE slug LIKE 'smoke-gw%'; DELETE FROM upstreams WHERE name LIKE 'smoke-gw%';")
await admin('POST', '/api/user/login', { username: 'admin', password: PASSWORD })

const chatUp = await admin('POST', '/api/channel', { channel: { name: 'smoke-gw-chat', responses_mode: 'convert', base_url: MOCK_FOR_GATEWAY, key: 'mock-chat-key' } })
const nativeUp = await admin('POST', '/api/channel', { channel: { name: 'smoke-gw-native', responses_mode: 'native', base_url: MOCK_FOR_GATEWAY, anthropic_base_url: `${MOCK_FOR_GATEWAY}/anthropic/`, key: 'mock-native-key' } })
const offUp = await admin('POST', '/api/channel', { channel: { name: 'smoke-gw-off', responses_mode: 'convert', base_url: MOCK_FOR_GATEWAY, key: 'k', status: 2 } })
const chatOnlyUp = await admin('POST', '/api/channel', { channel: { name: 'smoke-gw-chatonly', base_url: MOCK_FOR_GATEWAY, key: 'mock-chatonly-key' } })
check('按指定的 Responses 方式保存', nativeUp.responses_mode === 'native', nativeUp.responses_mode)
check('新建上游默认不提供 Responses', chatOnlyUp.responses_mode === 'none', chatOnlyUp.responses_mode)
check('Anthropic 地址去掉结尾斜杠', nativeUp.anthropic_base_url === `${MOCK_FOR_GATEWAY}/anthropic`, nativeUp.anthropic_base_url)

const app = await admin('POST', '/api/user', { username: 'smoke-gw', quota: 0 })
const alias = (name, upstream, model) => ({ name, upstream_id: upstream.id, upstream_model: model })
await admin('PUT', `/api/app/${app.id}/aliases`, {
  aliases: [
    alias('smoke-gw-chat', chatUp, 'normal'),
    alias('smoke-gw-native', nativeUp, 'normal'),
    alias('smoke-gw-tool', chatUp, 'tool'),
    alias('smoke-gw-nousage', chatUp, 'nousage'),
    alias('smoke-gw-slow', chatUp, 'slow'),
    alias('smoke-gw-error', chatUp, 'error'),
    alias('smoke-gw-off', offUp, 'normal'),
    alias('smoke-gw-hidden', chatUp, 'normal'),
    alias('smoke-gw-chatonly', chatOnlyUp, 'normal'),
  ],
})
const token = await admin('POST', '/api/token', { user_id: app.id, name: 'smoke-gw-main', expired_time: -1 })
const key = token.key

// ---------------------------------------------------------------------------
console.log('\n鉴权和模型列表')

let res = await gw('/v1/responses', null, { model: 'smoke-gw-chat', input: 'hi' })
let json = await res.json()
check('没带令牌 401', res.status === 401 && json.error?.type === 'authentication_error', json)

res = await gw('/v1/responses', 'not-a-real-key', { model: 'smoke-gw-chat', input: 'hi' })
check('令牌不对 401', res.status === 401, res.status)

res = await gw('/v1/models', key)
json = await res.json()
check('模型列表是应用的全部别名', json.data?.length === 9 && json.data.some((m) => m.id === 'smoke-gw-hidden'), json)

res = await gw('/v1/responses', key, { model: 'smoke-gw-missing', input: 'hi' })
json = await res.json()
check('应用里没有的别名 400 model_not_found', res.status === 400 && json.error?.code === 'model_not_found', json)

res = await gw('/v1/responses', key, { model: 'smoke-gw-off', input: 'hi' })
check('上游停用 503', res.status === 503, res.status)

res = await gw('/v1/responses', key, { model: 'smoke-gw-chatonly', input: 'hi' })
json = await res.json()
check('上游不提供 Responses 时 /v1/responses 400', res.status === 400 && json.error?.code === 'responses_not_supported', json)

res = await gw('/v1/chat/completions', key, { model: 'smoke-gw-chatonly', messages: [{ role: 'user', content: 'hi' }] })
check('同一个上游的 /v1/chat/completions 照常可用', res.status === 200, res.status)

res = await gw('/v1/responses', key, { model: 'smoke-gw-chat', input: 'hi', previous_response_id: 'resp_x' })
json = await res.json()
check('不支持 previous_response_id', res.status === 400 && json.error?.code === 'unsupported_parameter', json)

res = await fetch(BASE + '/v1/responses', { method: 'POST', headers: { Authorization: `Bearer sk-${key}` }, body: '{oops' })
check('请求体不是 JSON 400', res.status === 400, res.status)

// ---------------------------------------------------------------------------
console.log('\n/v1/responses → Chat 上游（转换）')

res = await gw(
  '/v1/responses',
  key,
  { model: 'smoke-gw-chat', instructions: '你是助手', input: [{ role: 'user', content: [{ type: 'input_text', text: '你好' }] }], store: false },
  { 'X-Request-Id': 'smoke-gw-req-1' }
)
json = await res.json()
let upstreamReq = await mockLast()
check('转发到上游的 /chat/completions，模型换成上游模型名', upstreamReq.path === '/chat/completions' && upstreamReq.body.model === 'normal', upstreamReq)
check('instructions 变成 system 消息，去掉 store', upstreamReq.body.messages[0].role === 'system' && !('store' in upstreamReq.body), upstreamReq.body)
check('用的是上游自己的密钥', upstreamReq.authorization === 'Bearer mock-chat-key', upstreamReq.authorization)
check('响应头带回 X-Request-Id', res.headers.get('x-request-id') === 'smoke-gw-req-1', res.headers.get('x-request-id'))
const text = json.output?.find((o) => o.type === 'message')?.content?.[0]?.text
check('非流式转成 Responses，<think> 拆成 reasoning', text === '你好，世界' && json.output.some((o) => o.type === 'reasoning'), json)
let log = lastLog('smoke-gw-req-1')
check('记账：输入 10 / 输出 5，不是估算', log?.input_tokens === 10 && log.output_tokens === 5 && !log.estimated && log.error === '', log)

res = await gw('/v1/responses', key, { model: 'smoke-gw-chat', input: '你好', stream: true }, { 'X-Request-Id': 'smoke-gw-req-2' })
let events = await readEvents(res)
const types = events.map((e) => e.type)
upstreamReq = await mockLast()
check('流式请求要求上游返回 usage', upstreamReq.body.stream_options?.include_usage === true, upstreamReq.body)
check('流式事件名是标准的 response.output_text.delta', types.includes('response.output_text.delta') && !types.includes('response.content_part.delta'), types)
check('第一个事件是 response.created，最后是 response.completed', types[0] === 'response.created' && types.at(-1) === 'response.completed', types)
const streamed = events.filter((e) => e.type === 'response.output_text.delta').map((e) => e.delta).join('')
check('拆开的 <think> 标签被去掉', streamed === '你好，世界', streamed)
check('response.completed 带 usage', events.at(-1).response?.usage?.output_tokens === 5, events.at(-1))
await sleep(200)
log = lastLog('smoke-gw-req-2')
check('流式记账准确：10 / 5，有首字时间', log?.input_tokens === 10 && log.output_tokens === 5 && !log.estimated && log.is_stream === 1, log)

res = await gw('/v1/responses', key, { model: 'smoke-gw-tool', input: '北京天气', stream: true, tools: [{ type: 'function', name: 'get_weather', parameters: {} }] })
events = await readEvents(res)
const done = events.find((e) => e.type === 'response.function_call_arguments.done')
check('流式 tool call 转换', done?.arguments === '{"city":"北京"}' && events.at(-1).response.output.some((o) => o.type === 'function_call'), events.map((e) => e.type))
upstreamReq = await mockLast()
check('tools 转成 Chat 格式', upstreamReq.body.tools?.[0]?.function?.name === 'get_weather', upstreamReq.body.tools)

res = await gw('/v1/responses', key, { model: 'smoke-gw-nousage', input: '你好', stream: true }, { 'X-Request-Id': 'smoke-gw-req-3' })
events = await readEvents(res)
await sleep(200)
log = lastLog('smoke-gw-req-3')
check('上游没给 usage：completed 不带 usage，记账标估算', !events.at(-1).response.usage && log?.estimated === 1 && log.output_tokens > 0, log)

// ---------------------------------------------------------------------------
console.log('\n/v1/responses → 原生 Responses 上游（透传）')

res = await gw('/v1/responses', key, { model: 'smoke-gw-native', input: '你好', stream: true, store: false, metadata: { a: 1 } }, { 'X-Request-Id': 'smoke-gw-req-4' })
events = await readEvents(res)
upstreamReq = await mockLast()
check('转发到上游的 /responses，去掉 store 和 metadata', upstreamReq.path === '/responses' && !('store' in upstreamReq.body) && !('metadata' in upstreamReq.body), upstreamReq)
check('原样透传事件', events.map((e) => e.delta ?? '').join('') === '原生回答', events)
await sleep(200)
log = lastLog('smoke-gw-req-4')
check('记账：11 / 7', log?.input_tokens === 11 && log.output_tokens === 7, log)

// ---------------------------------------------------------------------------
console.log('\n/v1/chat/completions')

res = await gw('/v1/chat/completions', key, { model: 'smoke-gw-chat', messages: [{ role: 'user', content: '你好' }], stream: true }, { 'X-Request-Id': 'smoke-gw-req-5' })
events = await readEvents(res)
upstreamReq = await mockLast()
check('直接转发 Chat 请求并要求 usage', upstreamReq.body.model === 'normal' && upstreamReq.body.stream_options?.include_usage, upstreamReq.body)
check('返回 Chat 的 chunk', events[0]?.object === 'chat.completion.chunk', events[0])
await sleep(200)
log = lastLog('smoke-gw-req-5')
check('记账：10 / 5', log?.input_tokens === 10 && log.output_tokens === 5, log)

// ---------------------------------------------------------------------------
console.log('\n/v1/messages（Anthropic，直接转发）')

const anthropic = (body, headers = {}) =>
  fetch(BASE + '/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': `sk-${key}`, ...headers },
    body: JSON.stringify(body),
  })

res = await anthropic({ model: 'smoke-gw-native', max_tokens: 64, messages: [{ role: 'user', content: '你好' }] }, { 'X-Request-Id': 'smoke-gw-req-a1' })
json = await res.json()
upstreamReq = await mockLast()
check('x-api-key 鉴权通过，非流式返回 Anthropic 消息', res.status === 200 && json.content?.[0]?.text === 'Anthropic 回答', json)
check(
  '转发到 <Anthropic 地址>/v1/messages，换成上游模型并带上密钥和默认版本',
  upstreamReq.path === '/anthropic/v1/messages' && upstreamReq.body.model === 'normal' && upstreamReq.apiKey === 'mock-native-key' && upstreamReq.anthropicVersion === '2023-06-01',
  upstreamReq
)
await sleep(200)
log = lastLog('smoke-gw-req-a1')
check('记账：输入含缓存 23 / 输出 9', log?.input_tokens === 23 && log.output_tokens === 9, log)

res = await anthropic({ model: 'smoke-gw-native', max_tokens: 64, stream: true, messages: [{ role: 'user', content: '你好' }] }, { 'X-Request-Id': 'smoke-gw-req-a2', 'anthropic-version': '2024-01-01' })
events = await readEvents(res)
upstreamReq = await mockLast()
check('流式原样透传 Anthropic 事件', events.filter((e) => e.type === 'content_block_delta').map((e) => e.delta.text).join('') === 'Anthropic 回答', events)
check('透传客户端的 anthropic-version', upstreamReq.anthropicVersion === '2024-01-01', upstreamReq)
await sleep(200)
log = lastLog('smoke-gw-req-a2')
check('流式记账：23 / 9', log?.input_tokens === 23 && log.output_tokens === 9, log)

res = await anthropic({ model: 'smoke-gw-chat', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] })
json = await res.json()
check(
  '上游没填 Anthropic 地址时 400，错误是 Anthropic 格式',
  res.status === 400 && json.type === 'error' && json.error?.type === 'invalid_request_error' && json.error.message.includes('/v1/chat/completions'),
  json
)

res = await fetch(BASE + '/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'sk-wrong' }, body: '{}' })
json = await res.json()
check('令牌不对 401，Anthropic 格式', res.status === 401 && json.error?.type === 'authentication_error', json)

// ---------------------------------------------------------------------------
console.log('\n上游出错')

const beforeError = tokenUsed(token.id)
res = await gw('/v1/responses', key, { model: 'smoke-gw-error', input: 'hi' }, { 'X-Request-Id': 'smoke-gw-req-6' })
json = await res.json()
check('上游 500 → 502 upstream_error，不透出上游细节', res.status === 502 && json.error?.type === 'upstream_error' && !JSON.stringify(json).includes('exploded'), json)
log = lastLog('smoke-gw-req-6')
check('记录错误、不扣额度', log?.status_code === 500 && log.error.includes('exploded') && tokenUsed(token.id) === beforeError, log)

// ---------------------------------------------------------------------------
console.log('\n调用方中途断开')

const { abortedStreams: abortedBefore } = await (await fetch(`${MOCK}/_stats`)).json()
const controller = new AbortController()
res = await gw('/v1/responses', key, { model: 'smoke-gw-slow', input: '慢慢说', stream: true }, { 'X-Request-Id': 'smoke-gw-req-7' })
const reader = res.body.getReader()
let received = ''
while (!received.includes('片段2')) {
  const { value } = await reader.read()
  received += new TextDecoder().decode(value)
}
await reader.cancel()
controller.abort()
await sleep(800)
const { abortedStreams } = await (await fetch(`${MOCK}/_stats`)).json()
check('上游连接被立即中止', abortedStreams === abortedBefore + 1, { abortedBefore, abortedStreams })
log = lastLog('smoke-gw-req-7')
check('记为 499，按已收到的输出估算', log?.status_code === 499 && log.estimated === 1 && log.output_tokens > 0, log)
check('估算的输出远小于完整 50 段', log && log.output_tokens < 30, log?.output_tokens)

// ---------------------------------------------------------------------------
console.log('\n并发和额度')

const before = tokenUsed(token.id)
const N = 20
const results = await Promise.all(
  Array.from({ length: N }, () => gw('/v1/responses', key, { model: 'smoke-gw-chat', input: 'hi' }).then((r) => r.status))
)
check(`${N} 个并发请求都成功`, results.every((s) => s === 200), results)
check(`令牌已用量正好增加 ${N} × 15`, tokenUsed(token.id) - before === N * 15, tokenUsed(token.id) - before)

// 应用额度 = 已用 + 20：每次 15，前两次放行（不预占），第三次 429
const usedNow = db.prepare('SELECT used FROM apps WHERE id = ?').get(app.id).used
await admin('PUT', '/api/user', { id: app.id, quota: usedNow + 20 })
const statuses = []
for (let i = 0; i < 3; i++) statuses.push((await gw('/v1/responses', key, { model: 'smoke-gw-chat', input: 'hi' })).status)
check('应用额度剩 20：前两次放行，第三次 429', JSON.stringify(statuses) === '[200,200,429]', statuses)
res = await gw('/v1/responses', key, { model: 'smoke-gw-chat', input: 'hi' })
json = await res.json()
check('应用额度用尽 429 app_quota_exhausted', res.status === 429 && json.error?.type === 'insufficient_quota' && json.error?.code === 'app_quota_exhausted', json)
await admin('PUT', '/api/user', { id: app.id, quota: 0 })

await admin('PUT', '/api/token/?status_only=true', { id: token.id, status: 2 })
res = await gw('/v1/responses', key, { model: 'smoke-gw-chat', input: 'hi' })
check('禁用的令牌 401', res.status === 401, res.status)

const ipToken = await admin('POST', '/api/token', { user_id: app.id, name: 'smoke-gw-ip', expired_time: -1, allow_ips: '10.0.0.0/8' })
res = await gw('/v1/models', ipToken.key)
check('来源 IP 不在白名单 401', res.status === 401, res.status)

const app2 = await admin('GET', `/api/user/${app.id}`)
check('应用的请求次数只计成功的请求', app2.request_count > 0, app2.request_count)

// ---------------------------------------------------------------------------
console.log('\n清理')
db.exec("DELETE FROM usage_logs WHERE app_slug = 'smoke-gw'")
await admin('DELETE', `/api/user/${app.id}`)
await admin('POST', '/api/channel/batch', { ids: [chatUp.id, nativeUp.id, offUp.id, chatOnlyUp.id] })
console.log('已删除测试数据')

console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
