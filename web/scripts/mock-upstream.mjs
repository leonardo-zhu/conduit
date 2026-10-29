#!/usr/bin/env node
/**
 * 假上游，给 scripts/gateway-smoke.mjs 用：同时提供 Chat Completions、原生 Responses，
 * 以及 /anthropic/v1/messages（Anthropic Messages，usage 为 输入 20 + 缓存 3 / 输出 9）。
 * 按请求里的 model 决定行为：
 *
 *   normal   正常回答，内容带 <think> 推理标签；usage 固定为 输入 10 / 输出 5（Responses 为 11 / 7）
 *   tool     返回一个 function call
 *   nousage  流式时不返回 usage
 *   slow     流式慢慢吐 50 个片段（每 100ms 一个），用来测调用方中途断开
 *   error    返回 500
 *
 * GET /_last 返回最近一次收到的请求（路径、请求体和鉴权相关的头），GET /_stats 返回被中途断开的流的数量。
 *
 *   node scripts/mock-upstream.mjs [端口，默认 3099]
 */
import http from 'node:http'

const PORT = Number(process.argv[2] || 3099)
let last = null
let abortedStreams = 0

const sse = (res) => res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
const data = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function chat(req, res, body) {
  const model = body.model
  if (model === 'error') {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: { message: 'mock upstream exploded' } }))
  }
  const id = 'chatcmpl-mock1'
  const base = { id, object: 'chat.completion.chunk', created: 1700000000, model }
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }

  if (!body.stream) {
    const message =
      model === 'tool'
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"北京"}' } }] }
        : { role: 'assistant', content: '<think>先想一想</think>你好，世界' }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ id, object: 'chat.completion', created: 1700000000, model, choices: [{ index: 0, message, finish_reason: model === 'tool' ? 'tool_calls' : 'stop' }], usage }))
  }

  sse(res)
  let closed = false
  res.on('close', () => {
    if (!res.writableEnded) {
      closed = true
      abortedStreams += 1
    }
  })
  data(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })
  if (model === 'tool') {
    data(res, { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '' } }] }, finish_reason: null }] })
    data(res, { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] }, finish_reason: null }] })
    data(res, { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"北京"}' } }] }, finish_reason: null }] })
    data(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
  } else if (model === 'slow') {
    for (let i = 0; i < 50 && !closed; i++) {
      data(res, { ...base, choices: [{ index: 0, delta: { content: `片段${i} ` }, finish_reason: null }] })
      await sleep(100)
    }
    if (closed) return
    data(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
  } else {
    // <think> 标签故意拆在两个 chunk 里
    for (const piece of ['<thi', 'nk>先想一想</th', 'ink>你好，', '世界']) {
      data(res, { ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })
    }
    data(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
  }
  if (model !== 'nousage' && body.stream_options?.include_usage) data(res, { ...base, choices: [], usage })
  res.end('data: [DONE]\n\n')
}

function responses(req, res, body) {
  const usage = { input_tokens: 11, output_tokens: 7, total_tokens: 18 }
  const message = { id: 'msg_1', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: '原生回答', annotations: [] }] }
  const response = { id: 'resp_native1', object: 'response', created_at: 1700000000, model: body.model, status: 'completed', output: [message], usage }
  if (!body.stream) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify(response))
  }
  sse(res)
  const event = (type, obj) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...obj })}\n\n`)
  event('response.created', { response: { ...response, status: 'in_progress', output: [], usage: null } })
  event('response.output_item.added', { output_index: 0, item: { ...message, status: 'in_progress', content: [] } })
  event('response.output_text.delta', { item_id: 'msg_1', output_index: 0, content_index: 0, delta: '原生' })
  event('response.output_text.delta', { item_id: 'msg_1', output_index: 0, content_index: 0, delta: '回答' })
  event('response.output_item.done', { output_index: 0, item: message })
  event('response.completed', { response })
  res.end()
}

function messages(req, res, body) {
  const message = {
    id: 'msg_anthropic1',
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [{ type: 'text', text: 'Anthropic 回答' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 20, cache_read_input_tokens: 3, output_tokens: 9 },
  }
  if (!body.stream) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify(message))
  }
  sse(res)
  const event = (type, obj) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...obj })}\n\n`)
  event('message_start', { message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 20, cache_read_input_tokens: 3, output_tokens: 1 } } })
  event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Anthropic ' } })
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '回答' } })
  event('content_block_stop', { index: 0 })
  event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } })
  event('message_stop', {})
  res.end()
}

http
  .createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/_last') return res.end(JSON.stringify(last))
    if (req.method === 'GET' && req.url === '/_stats') return res.end(JSON.stringify({ abortedStreams }))
    if (req.method === 'GET' && req.url === '/models') {
      return res.end(JSON.stringify({ object: 'list', data: [{ id: 'normal' }, { id: 'tool' }] }))
    }
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    last = {
      path: req.url,
      body,
      authorization: req.headers.authorization,
      apiKey: req.headers['x-api-key'],
      anthropicVersion: req.headers['anthropic-version'],
    }
    if (req.url === '/chat/completions') return chat(req, res, body)
    if (req.url === '/responses') return responses(req, res, body)
    if (req.url === '/anthropic/v1/messages') return messages(req, res, body)
    res.writeHead(404).end()
  })
  .listen(PORT, '127.0.0.1', () => console.log(`mock upstream on http://127.0.0.1:${PORT}`))
