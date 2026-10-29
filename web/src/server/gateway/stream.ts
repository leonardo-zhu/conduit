/**
 * 把上游的 SSE 流转给调用方，同时在旁边读出用量。
 *
 * - 字节原样转发（需要协议转换的，转换在这之前做完）
 * - 读 usage：Responses 流看 response.completed / incomplete / failed 里的 response.usage，
 *   Chat 流看带 usage 的 chunk；同时记首个 token 的时间和输出的字符数（拿不到 usage 时估算用）
 * - 调用方断开：立即中止上游请求，按已经收到的输出记账
 * - 上游超过 idleMs 没有任何数据：中止上游，在流里发一个错误事件后结束
 */

export type StreamKind = 'responses' | 'chat'

export interface StreamOutcome {
  usage?: { input: number; output: number }
  firstTokenAt?: number
  outputChars: number
  /** 调用方中途断开 */
  aborted: boolean
  /** 流里出现的错误（上游的 error 事件、超时、连接断开） */
  error?: string
  timedOut: boolean
}

type Json = Record<string, unknown>

class UsageTap {
  outcome: StreamOutcome = { outputChars: 0, aborted: false, timedOut: false }
  private buffer = ''
  private decoder = new TextDecoder()

  constructor(private kind: StreamKind) {}

  feed(chunk: Uint8Array) {
    this.buffer += this.decoder.decode(chunk, { stream: true })
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) this.line(line)
  }

  flush() {
    if (this.buffer) this.line(this.buffer)
    this.buffer = ''
  }

  private sawOutput(text: string) {
    this.outcome.firstTokenAt ??= Date.now()
    this.outcome.outputChars += text.length
  }

  private line(raw: string) {
    const line = raw.trim()
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') return
    let json: Json
    try {
      json = JSON.parse(data) as Json
    } catch {
      return
    }
    if (this.kind === 'responses') this.responsesEvent(json)
    else this.chatChunk(json)
  }

  private responsesEvent(event: Json) {
    switch (event.type) {
      case 'response.output_text.delta':
      case 'response.function_call_arguments.delta':
      case 'response.reasoning_summary_text.delta':
        this.sawOutput(String(event.delta ?? ''))
        break
      case 'response.completed':
      case 'response.incomplete':
      case 'response.failed': {
        const response = event.response as Json | undefined
        const usage = response?.usage as Json | undefined
        if (usage) this.outcome.usage = { input: Number(usage.input_tokens ?? 0), output: Number(usage.output_tokens ?? 0) }
        if (event.type === 'response.failed') {
          const error = response?.error as Json | undefined
          this.outcome.error = `上游返回 response.failed：${String(error?.message ?? '')}`.slice(0, 300)
        }
        break
      }
      case 'error':
        this.outcome.error = `上游流内错误：${String(event.message ?? event.code ?? '')}`.slice(0, 300)
        break
    }
  }

  private chatChunk(chunk: Json) {
    const usage = chunk.usage as Json | undefined
    if (usage) this.outcome.usage = { input: Number(usage.prompt_tokens ?? 0), output: Number(usage.completion_tokens ?? 0) }
    if (chunk.error) {
      const error = chunk.error as Json
      this.outcome.error = `上游流内错误：${String(error.message ?? '')}`.slice(0, 300)
    }
    const delta = (chunk.choices as Json[] | undefined)?.[0]?.delta as Json | undefined
    if (!delta) return
    if (typeof delta.content === 'string' && delta.content) this.sawOutput(delta.content)
    for (const tc of (delta.tool_calls as Json[] | undefined) ?? []) {
      this.sawOutput(String((tc.function as Json | undefined)?.arguments ?? ''))
    }
  }
}

/** 流里的错误事件：Responses 用 error 事件，Chat 用带 error 的 data 行 */
function errorEvent(kind: StreamKind, code: string, message: string): Uint8Array {
  const text =
    kind === 'responses'
      ? `event: error\ndata: ${JSON.stringify({ type: 'error', code, message })}\n\n`
      : `data: ${JSON.stringify({ error: { type: code === 'upstream_timeout' ? 'upstream_timeout' : 'upstream_error', code, message } })}\n\n`
  return new TextEncoder().encode(text)
}

class IdleTimeout extends Error {}

export function relayStream(
  source: ReadableStream<Uint8Array>,
  options: {
    kind: StreamKind
    upstream: AbortController
    idleMs: number
    onEnd: (outcome: StreamOutcome) => void
  }
): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  const tap = new UsageTap(options.kind)
  let ended = false

  const end = (patch: Partial<StreamOutcome> = {}) => {
    if (ended) return
    ended = true
    tap.flush()
    options.onEnd({ ...tap.outcome, ...patch })
  }

  const stopUpstream = () => {
    options.upstream.abort()
    reader.cancel().catch(() => {})
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new IdleTimeout()), options.idleMs)
          }),
        ])
        if (result.done) {
          end()
          controller.close()
          return
        }
        tap.feed(result.value)
        controller.enqueue(result.value)
      } catch (error) {
        if (ended) return
        stopUpstream()
        const timedOut = error instanceof IdleTimeout
        const message = timedOut ? '上游长时间没有返回数据' : '与上游的连接中断'
        controller.enqueue(errorEvent(options.kind, timedOut ? 'upstream_timeout' : 'upstream_error', message))
        end({ error: message, timedOut })
        controller.close()
      } finally {
        clearTimeout(timer)
      }
    },
    cancel() {
      // 调用方断开（或 Next.js 取消了响应流）
      stopUpstream()
      end({ aborted: true })
    },
  })
}
