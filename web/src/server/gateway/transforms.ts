/**
 * Responses API ↔ Chat Completions 的协议转换，迁自 adapter/lib/transforms.ts
 * （设计说明见 adapter/CONVERSION.md）。和 adapter 版本的差别：
 *
 * - 流式输出用 Responses API 的标准事件名（response.output_text.delta / .done），
 *   adapter 用的是非标准的 response.content_part.delta；并带上 sequence_number
 * - 流结束不再追加 data: [DONE]（Responses API 没有这个约定）
 * - 上游没给 usage 时 response.completed 里不带 usage，网关据此改为估算
 * - tool_choice 也做转换
 */

export type Body = Record<string, unknown>
export type Transform = (body: Body) => Body

export function compose(...transforms: Transform[]): Transform {
  return (body) => transforms.reduce((b, fn) => fn(b), body)
}

/** 剥掉顶层黑名单字段 */
export function stripTopLevel(blocklist: string[]): Transform {
  return (body) => {
    const result = { ...body }
    for (const key of blocklist) delete result[key]
    return result
  }
}

/** 过滤掉不支持的 tool type，全部被过滤时同时移除 tool_choice */
export function filterTools(allowedTypes: string[]): Transform {
  const allowed = new Set(allowedTypes)
  return (body) => {
    const tools = body.tools
    if (!Array.isArray(tools) || tools.length === 0) return body
    const filtered = tools.filter(
      (t) => typeof t === 'object' && t !== null && allowed.has((t as Body).type as string)
    )
    const result = { ...body }
    if (filtered.length > 0) {
      result.tools = filtered
    } else {
      delete result.tools
      delete result.tool_choice
    }
    return result
  }
}

/**
 * 补上 input item 缺少的 status 字段。
 * Codex 已知 bug：多轮对话历史 item 缺少该字段，严格遵守 spec 的服务端会报 MissingParameter
 */
export function fillInputItemStatus(defaultStatus = 'completed'): Transform {
  return (body) => {
    const input = body.input
    if (!Array.isArray(input)) return body
    return {
      ...body,
      input: input.map((item) => {
        if (typeof item !== 'object' || item === null || 'status' in item) return item
        return { ...(item as Body), status: defaultStatus }
      }),
    }
  }
}

// ---------------------------------------------------------------------------
// 请求：Responses → Chat
// ---------------------------------------------------------------------------

const TEXT_TYPES = new Set(['text', 'input_text', 'output_text'])

/** content parts → 纯文本时拼成 string，含图片等时保留 array 并转成 Chat 的 part 格式 */
function normalizeContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content
  const allText = content.every(
    (p) => typeof p === 'object' && p !== null && TEXT_TYPES.has((p as Body).type as string)
  )
  if (allText) return content.map((p) => (p as Body).text ?? '').join('')
  return content.map((p) => {
    if (typeof p !== 'object' || p === null) return p
    const part = p as Body
    if (TEXT_TYPES.has(part.type as string)) return { type: 'text', text: part.text ?? '' }
    // Responses 的 input_image：{ type, image_url: string } → Chat 的 { type: 'image_url', image_url: { url } }
    if (part.type === 'input_image' && typeof part.image_url === 'string') {
      return { type: 'image_url', image_url: { url: part.image_url, detail: part.detail } }
    }
    return part
  })
}

/**
 * Responses 请求 → Chat Completions 请求：
 * input → messages（developer → system，多条 system 合并），instructions → system，
 * function_call / function_call_output → tool_calls / tool 消息，
 * tools 和 tool_choice 换格式，max_output_tokens → max_tokens，text.format → response_format
 */
export function responsesToChat(): Transform {
  return (body) => {
    const { input, instructions, tools, tool_choice, max_output_tokens, text, ...rest } = body as Body & {
      input?: unknown
      instructions?: string
      tools?: unknown[]
      tool_choice?: unknown
      max_output_tokens?: number
      text?: Body
    }
    const result: Body = { ...rest }

    if (max_output_tokens != null) result.max_tokens = max_output_tokens
    // 流式时要求上游在末尾返回 usage，网关按它记账
    if (result.stream === true) {
      result.stream_options = { ...(result.stream_options as Body | undefined), include_usage: true }
    }

    const format = text && typeof text === 'object' ? (text.format as Body | undefined) : undefined
    if (format?.type === 'json_schema') {
      result.response_format = { type: 'json_schema', json_schema: format }
    }

    if (Array.isArray(tools) && tools.length > 0) {
      result.tools = tools.map((t) => {
        const { type, name, description, parameters } = t as Body
        return type === 'function' ? { type: 'function', function: { name, description, parameters } } : t
      })
    }
    if (tool_choice !== undefined) {
      const choice = tool_choice as Body
      result.tool_choice =
        typeof tool_choice === 'object' && tool_choice !== null && choice.type === 'function'
          ? { type: 'function', function: { name: choice.name } }
          : tool_choice
    }

    let items: unknown[]
    if (typeof input === 'string') items = [{ role: 'user', content: input }]
    else if (Array.isArray(input)) items = input
    else return result

    const messages: Body[] = []
    const systemParts: string[] = []
    if (instructions) systemParts.push(instructions)

    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue
      const it = item as Body
      if (it.type === 'function_call') {
        messages.push({
          role: 'assistant',
          tool_calls: [
            { id: it.call_id ?? it.id, type: 'function', function: { name: it.name, arguments: it.arguments } },
          ],
        })
      } else if (it.type === 'function_call_output') {
        messages.push({
          role: 'tool',
          tool_call_id: it.call_id,
          content: typeof it.output === 'string' ? it.output : JSON.stringify(it.output),
        })
      } else if (it.type === 'message' || it.role != null) {
        const role = it.role === 'developer' ? 'system' : it.role
        const content = normalizeContent(it.content)
        if (content === '' || content == null) continue
        // system 消息合并成一条（MiniMax 等不支持多条 system）
        if (role === 'system') systemParts.push(typeof content === 'string' ? content : JSON.stringify(content))
        else messages.push({ role, content })
      }
    }
    if (systemParts.length > 0) messages.unshift({ role: 'system', content: systemParts.join('\n\n') })
    result.messages = messages
    return result
  }
}

// ---------------------------------------------------------------------------
// 非流式响应：Chat → Responses
// ---------------------------------------------------------------------------

function toResponseId(id: unknown): string {
  const raw = String(id ?? '')
  if (raw.startsWith('chatcmpl-')) return `resp-${raw.slice('chatcmpl-'.length)}`
  return raw.startsWith('resp-') ? raw : `resp-${raw}`
}

/** MiniMax 等模型把推理放在 <think> 标签里 */
function extractThinkTags(content: string): { reasoning: string | null; visible: string } {
  const match = content.match(/<think>([\s\S]*?)<\/think>/)
  if (!match) return { reasoning: null, visible: content }
  return { reasoning: match[1].trim(), visible: content.replace(/<think>[\s\S]*?<\/think>\n?/, '').trim() }
}

export function chatToResponses(): Transform {
  return (chat) => {
    const choice = (chat.choices as Body[] | undefined)?.[0]
    const message = choice?.message as Body | undefined
    const usage = chat.usage as Body | undefined
    const respId = toResponseId(chat.id)
    const output: Body[] = []

    if (message) {
      const content = message.content
      if (content != null && content !== '') {
        const { reasoning, visible } = extractThinkTags(typeof content === 'string' ? content : JSON.stringify(content))
        if (reasoning) {
          output.push({ id: `rsn-${respId}`, type: 'reasoning', status: 'completed', summary: [{ type: 'summary_text', text: reasoning }] })
        }
        if (visible) {
          output.push({
            id: `msg-${respId}-0`,
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text: visible, annotations: [] }],
          })
        }
      }
      const toolCalls = message.tool_calls as Body[] | undefined
      toolCalls?.forEach((tc, i) => {
        const fn = tc.function as Body | undefined
        output.push({
          id: `fc-${respId}-${i}`,
          type: 'function_call',
          status: 'completed',
          call_id: tc.id,
          name: fn?.name ?? '',
          arguments: fn?.arguments ?? '{}',
        })
      })
    }

    return {
      id: respId,
      object: 'response',
      created_at: chat.created ?? Math.floor(Date.now() / 1000),
      model: chat.model ?? '',
      status: choice?.finish_reason === 'length' ? 'incomplete' : 'completed',
      output,
      ...(usage
        ? {
            usage: {
              input_tokens: usage.prompt_tokens ?? 0,
              output_tokens: usage.completion_tokens ?? 0,
              total_tokens: usage.total_tokens ?? 0,
            },
          }
        : {}),
    }
  }
}

// ---------------------------------------------------------------------------
// 流式响应：Chat SSE → Responses SSE
// ---------------------------------------------------------------------------

/**
 * Chat Completions 的 SSE 流转成 Responses API 的 SSE 流。
 * 推理内容（<think> 标签内）在流式里直接丢掉，只输出可见文本。
 */
export function createChatToResponsesStream(): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  let responseId = ''
  let model = ''
  let createdAt = 0
  let buffer = ''
  let sequence = 0
  let nextOutputIndex = 0
  let finished = false
  let completedSent = false
  let finalStatus = 'completed'
  // include_usage 时 usage 在 finish_reason 之后单独一个 chunk，所以 response.completed 推迟到流结束再发
  let latestUsage: Body | undefined
  const completedItems: Body[] = []

  // 当前的 message item
  let msg: { id: string; index: number; text: string; partOpen: boolean } | null = null
  let msgCounter = 0
  // 并行 tool_calls：Chat 的 tool_call index → 状态
  const toolCalls = new Map<number, { itemId: string; callId: string; name: string; args: string; index: number }>()

  const emit = (type: string, data: Body) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`

  function openMessage(): string {
    if (msg) return ''
    msg = { id: `msg-${responseId}-${msgCounter++}`, index: nextOutputIndex++, text: '', partOpen: false }
    return emit('response.output_item.added', {
      output_index: msg.index,
      item: { id: msg.id, type: 'message', status: 'in_progress', role: 'assistant', content: [] },
    })
  }

  function closeMessage(): string {
    if (!msg) return ''
    const m = msg
    msg = null
    const part = { type: 'output_text', text: m.text, annotations: [] }
    let out = ''
    if (m.partOpen) {
      out += emit('response.output_text.done', { item_id: m.id, output_index: m.index, content_index: 0, text: m.text })
      out += emit('response.content_part.done', { item_id: m.id, output_index: m.index, content_index: 0, part })
    }
    const item = { id: m.id, type: 'message', status: 'completed', role: 'assistant', content: m.partOpen ? [part] : [] }
    completedItems.push(item)
    return out + emit('response.output_item.done', { output_index: m.index, item })
  }

  function emitText(text: string): string {
    let out = openMessage()
    const m = msg!
    if (!m.partOpen) {
      m.partOpen = true
      out += emit('response.content_part.added', {
        item_id: m.id,
        output_index: m.index,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] },
      })
    }
    m.text += text
    return out + emit('response.output_text.delta', { item_id: m.id, output_index: m.index, content_index: 0, delta: text })
  }

  // <think> 标签可能被拆在两个 chunk 里，pendingTag 存着可能是标签开头的尾巴
  const OPEN = '<think>'
  const CLOSE = '</think>'
  let inThink = false
  let pendingTag = ''

  function processContent(text: string): string {
    let out = ''
    let content = pendingTag + text
    pendingTag = ''
    while (content.length > 0) {
      const tag = inThink ? CLOSE : OPEN
      const idx = content.indexOf(tag)
      if (idx !== -1) {
        if (!inThink && idx > 0) out += emitText(content.slice(0, idx))
        inThink = !inThink
        content = content.slice(idx + tag.length)
        continue
      }
      // 结尾可能是半个标签，先留着
      let keep = 0
      for (let i = tag.length - 1; i > 0; i--) {
        if (content.endsWith(tag.slice(0, i))) {
          keep = i
          break
        }
      }
      const safe = content.slice(0, content.length - keep)
      if (!inThink && safe) out += emitText(safe)
      pendingTag = content.slice(content.length - keep)
      content = ''
    }
    return out
  }

  function finish(reason: string): string {
    if (finished) return ''
    finished = true
    let out = closeMessage()
    for (const tc of toolCalls.values()) {
      const item = { id: tc.itemId, type: 'function_call', status: 'completed', call_id: tc.callId, name: tc.name, arguments: tc.args }
      out += emit('response.function_call_arguments.done', { item_id: tc.itemId, output_index: tc.index, arguments: tc.args })
      out += emit('response.output_item.done', { output_index: tc.index, item })
      completedItems.push(item)
    }
    toolCalls.clear()
    finalStatus = reason === 'length' ? 'incomplete' : 'completed'
    return out
  }

  function processChunk(json: Body): string {
    let out = ''
    if (!responseId) {
      responseId = toResponseId(json.id)
      model = String(json.model ?? '')
      createdAt = (json.created as number) ?? Math.floor(Date.now() / 1000)
      const response = { id: responseId, object: 'response', created_at: createdAt, model, status: 'in_progress', output: [] }
      out += emit('response.created', { response })
      out += emit('response.in_progress', { response })
    }
    if (json.usage) latestUsage = json.usage as Body

    const choice = (json.choices as Body[] | undefined)?.[0]
    const delta = choice?.delta as Body | undefined
    if (delta && typeof delta.content === 'string' && delta.content) out += processContent(delta.content)

    const deltaCalls = delta?.tool_calls as Body[] | undefined
    if (Array.isArray(deltaCalls) && deltaCalls.length > 0) {
      out += closeMessage()
      for (const tc of deltaCalls) {
        const idx = Number(tc.index ?? 0)
        const fn = tc.function as Body | undefined
        const args = String(fn?.arguments ?? '')
        let state = toolCalls.get(idx)
        if (!state) {
          const itemId = `fc-${responseId}-${idx}`
          state = { itemId, callId: String(tc.id ?? itemId), name: String(fn?.name ?? ''), args: '', index: nextOutputIndex++ }
          toolCalls.set(idx, state)
          out += emit('response.output_item.added', {
            output_index: state.index,
            item: { id: itemId, type: 'function_call', status: 'in_progress', call_id: state.callId, name: state.name, arguments: '' },
          })
        }
        if (args) {
          state.args += args
          out += emit('response.function_call_arguments.delta', { item_id: state.itemId, output_index: state.index, delta: args })
        }
      }
    }

    const reason = choice?.finish_reason as string | null | undefined
    if (reason != null) out += finish(reason)
    return out
  }

  /** 流结束时发 response.completed，只发一次；上游没给 usage 就不带 usage 字段 */
  function completed(): string {
    if (completedSent || !responseId) return ''
    completedSent = true
    let out = finish('stop')
    const usage = latestUsage
      ? {
          input_tokens: latestUsage.prompt_tokens ?? 0,
          output_tokens: latestUsage.completion_tokens ?? 0,
          total_tokens: latestUsage.total_tokens ?? 0,
        }
      : undefined
    out += emit('response.completed', {
      response: {
        id: responseId,
        object: 'response',
        created_at: createdAt,
        model,
        status: finalStatus,
        output: completedItems,
        ...(usage ? { usage } : {}),
      },
    })
    return out
  }

  function handleLine(line: string, controller: TransformStreamDefaultController<Uint8Array>) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (data === '[DONE]') {
      const out = completed()
      if (out) controller.enqueue(encoder.encode(out))
      return
    }
    try {
      const out = processChunk(JSON.parse(data) as Body)
      if (out) controller.enqueue(encoder.encode(out))
    } catch {
      // 跳过不是 JSON 的行
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) handleLine(line, controller)
    },
    flush(controller) {
      if (buffer) handleLine(buffer, controller)
      // 上游没发 [DONE] 就结束了：照样补齐 response.completed
      const out = completed()
      if (out) controller.enqueue(encoder.encode(out))
    },
  })
}

// ---------------------------------------------------------------------------
// 按上游协议组装请求变换
// ---------------------------------------------------------------------------

/** 原生 Responses 上游（火山方舟）：去掉它不认的字段 */
export const prepareNativeResponses = compose(
  stripTopLevel(['client_metadata', 'service_tier', 'store', 'metadata']),
  filterTools(['function', 'code_interpreter', 'retrieval']),
  fillInputItemStatus()
)

/** 只支持 Chat 的上游：转成 Chat Completions */
export const prepareChatFromResponses = compose(
  stripTopLevel(['store', 'metadata', 'client_metadata', 'service_tier', 'include', 'prompt_cache_key', 'reasoning', 'parallel_tool_calls', 'previous_response_id']),
  filterTools(['function']),
  fillInputItemStatus(),
  responsesToChat()
)
