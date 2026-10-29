/**
 * 网关数据面：/v1/responses 和 /v1/chat/completions 的处理流程。
 *
 *   令牌鉴权 → 别名解析 → 额度检查 → 按上游提供的接口改写请求 → 转发
 *   → 流式：边转发边读用量；非流式：读完整响应（需要时转换格式）
 *   → 记用量、扣额度
 *
 * 应用调哪个入口由应用自己选。上游提供的接口（upstreams.responses_mode）：
 * - /v1/chat/completions：所有上游都直接转发到上游的 /chat/completions
 * - /v1/responses：native 直接转发到上游的 /responses；convert 由网关转成 Chat 再转回来；
 *   none 表示这个上游不提供 Responses API，直接拒绝
 */
import { randomUUID } from 'node:crypto'

import type { NextRequest } from 'next/server'

import { listAliases } from '../api/apps'
import { upstreamKey } from '../api/upstreams'
import { clientIp } from '../auth'
import { parseJsonArray } from '../db'
import { authenticate, checkQuota, resolveAlias, type GatewayAuth, type RouteTarget } from './context'
import { errorResponse, GatewayError } from './errors'
import { recordUsage, estimateTokens } from './record'
import { relayStream, type StreamKind } from './stream'
import {
  chatToResponses,
  createChatToResponsesStream,
  prepareChatFromResponses,
  prepareNativeResponses,
  type Body,
} from './transforms'

export type Endpoint = 'responses' | 'chat'

/** 等上游返回响应头的上限（含排队和首包），以及非流式请求的总时长上限 */
const HEADERS_TIMEOUT_MS = 120_000
const NON_STREAM_TIMEOUT_MS = 300_000
/** 流式时上游多久没有任何数据算超时 */
const STREAM_IDLE_MS = 300_000

function requestIdOf(req: NextRequest): string {
  const given = req.headers.get('x-request-id')
  return given && /^[\w.:-]{1,128}$/.test(given) ? given : `req_${randomUUID().replaceAll('-', '')}`
}

/** 按上游协议改写请求，返回目标路径和请求体 */
function buildUpstreamRequest(endpoint: Endpoint, target: RouteTarget, body: Body) {
  const withModel: Body = { ...body, model: target.upstreamModel }
  if (endpoint === 'chat') {
    // 流式时要求上游在末尾返回 usage
    if (withModel.stream === true) {
      withModel.stream_options = { ...(withModel.stream_options as Body | undefined), include_usage: true }
    }
    return { path: '/chat/completions', body: withModel, convert: false }
  }
  if (target.upstream.responses_mode === 'native') {
    return { path: '/responses', body: prepareNativeResponses(withModel), convert: false }
  }
  if (target.upstream.responses_mode === 'convert') {
    return { path: '/chat/completions', body: prepareChatFromResponses(withModel), convert: true }
  }
  throw new GatewayError(
    'invalid_request_error',
    'responses_not_supported',
    `模型别名 ${target.alias} 的上游不提供 Responses API，请改用 /v1/chat/completions`
  )
}

/** 估算用：请求里的文本长度（去掉 base64 图片） */
function requestChars(body: Body): number {
  const text = JSON.stringify([body.instructions ?? '', body.input ?? '', body.messages ?? ''])
  return text.replace(/data:[^"]+/g, '').length
}

function upstreamErrorFor(status: number, text: string): GatewayError {
  const detail = `上游返回 ${status}：${text.slice(0, 300)}`
  // 参数类错误多半是请求本身的问题，转成 400 让调用方知道；鉴权、限流、5xx 都是上游的问题
  if ([400, 404, 413, 422].includes(status)) {
    return new GatewayError('invalid_request_error', 'upstream_rejected', `上游拒绝了请求（${status}）`, detail)
  }
  return new GatewayError('upstream_error', 'upstream_error', `上游出错（${status}）`, detail)
}

export async function handleGateway(req: NextRequest, endpoint: Endpoint): Promise<Response> {
  const started = Date.now()
  const requestId = requestIdOf(req)
  const ip = clientIp(req)
  let auth: GatewayAuth | undefined
  let target: RouteTarget | undefined
  let isStream = false

  const record = (fields: {
    statusCode: number
    error: string
    usage?: { input: number; output: number }
    estimate?: { inputChars: number; outputChars: number }
    firstTokenAt?: number
  }) => {
    if (!auth || !target) return
    const estimated = !fields.usage && !!fields.estimate
    recordUsage({
      requestId,
      auth,
      target,
      isStream,
      statusCode: fields.statusCode,
      error: fields.error,
      inputTokens: fields.usage?.input ?? (estimated ? estimateTokens(fields.estimate!.inputChars) : 0),
      outputTokens: fields.usage?.output ?? (estimated ? estimateTokens(fields.estimate!.outputChars) : 0),
      estimated,
      firstTokenMs: fields.firstTokenAt ? fields.firstTokenAt - started : 0,
      durationMs: Date.now() - started,
      ip,
    })
  }

  try {
    auth = authenticate(req.headers.get('authorization'), ip)

    let body: Body
    try {
      body = (await req.json()) as Body
    } catch {
      throw new GatewayError('invalid_request_error', 'invalid_json', '请求体不是合法的 JSON')
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new GatewayError('invalid_request_error', 'invalid_json', '请求体必须是 JSON 对象')
    }
    if (endpoint === 'responses' && body.previous_response_id) {
      throw new GatewayError(
        'invalid_request_error',
        'unsupported_parameter',
        '不支持 previous_response_id：Conduit 不保存会话，每次请求请带上完整上下文'
      )
    }
    isStream = body.stream === true

    target = resolveAlias(auth, body.model)
    checkQuota(auth)

    const upstreamReq = buildUpstreamRequest(endpoint, target, body)
    const upstream = new AbortController()
    // 调用方断开时中止上游（流式的断开由 relayStream 处理，这里管等待响应头和非流式的阶段）
    const onClientAbort = () => upstream.abort()
    req.signal.addEventListener('abort', onClientAbort)
    const timer = setTimeout(() => upstream.abort(new Error('timeout')), isStream ? HEADERS_TIMEOUT_MS : NON_STREAM_TIMEOUT_MS)

    let res: Response
    try {
      res = await fetch(`${target.upstream.base_url}${upstreamReq.path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${upstreamKey(target.upstream)}`,
          'Content-Type': 'application/json',
          Accept: isStream ? 'text/event-stream' : 'application/json',
        },
        body: JSON.stringify(upstreamReq.body),
        signal: upstream.signal,
      })
    } catch (error) {
      clearTimeout(timer)
      req.signal.removeEventListener('abort', onClientAbort)
      if (req.signal.aborted) {
        record({ statusCode: 499, error: '调用方在上游响应前断开' })
        return new Response(null, { status: 499 })
      }
      const timedOut = upstream.signal.aborted
      record({ statusCode: timedOut ? 504 : 502, error: timedOut ? '等待上游响应超时' : `连接上游失败：${String(error)}` })
      throw timedOut
        ? new GatewayError('upstream_timeout', 'upstream_timeout', '上游响应超时')
        : new GatewayError('upstream_error', 'upstream_unreachable', '连接上游失败', String(error))
    }

    if (!res.ok) {
      clearTimeout(timer)
      req.signal.removeEventListener('abort', onClientAbort)
      const text = await res.text().catch(() => '')
      const error = upstreamErrorFor(res.status, text)
      record({ statusCode: res.status, error: error.detail ?? error.message })
      throw error
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('text/event-stream') && res.body) {
      clearTimeout(timer)
      req.signal.removeEventListener('abort', onClientAbort)
      const kind: StreamKind = endpoint === 'responses' ? 'responses' : 'chat'
      const source = upstreamReq.convert ? res.body.pipeThrough(createChatToResponsesStream()) : res.body
      const inputChars = requestChars(upstreamReq.body)
      const stream = relayStream(source, {
        kind,
        upstream,
        idleMs: STREAM_IDLE_MS,
        onEnd: (outcome) => {
          const error = outcome.aborted ? '调用方中途断开' : (outcome.error ?? '')
          record({
            statusCode: outcome.aborted ? 499 : outcome.timedOut ? 504 : 200,
            error,
            usage: outcome.usage,
            estimate: { inputChars, outputChars: outcome.outputChars },
            firstTokenAt: outcome.firstTokenAt,
          })
        },
      })
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
          'X-Request-Id': requestId,
        },
      })
    }

    // 非流式
    let json: Body
    try {
      json = (await res.json()) as Body
    } catch (error) {
      if (req.signal.aborted) {
        record({ statusCode: 499, error: '调用方在上游响应前断开' })
        return new Response(null, { status: 499 })
      }
      record({ statusCode: 502, error: `上游返回的不是 JSON：${String(error)}` })
      throw new GatewayError('upstream_error', 'invalid_upstream_response', '上游返回的内容无法解析')
    } finally {
      clearTimeout(timer)
      req.signal.removeEventListener('abort', onClientAbort)
    }
    const output = upstreamReq.convert ? chatToResponses()(json) : json
    const usage = output.usage as Body | undefined
    const tokens = usage
      ? endpoint === 'responses'
        ? { input: Number(usage.input_tokens ?? 0), output: Number(usage.output_tokens ?? 0) }
        : { input: Number(usage.prompt_tokens ?? 0), output: Number(usage.completion_tokens ?? 0) }
      : undefined
    record({
      statusCode: 200,
      error: '',
      usage: tokens,
      estimate: { inputChars: requestChars(upstreamReq.body), outputChars: JSON.stringify(output.output ?? output.choices ?? '').length },
    })
    return Response.json(output, { headers: { 'X-Request-Id': requestId } })
  } catch (error) {
    if (error instanceof GatewayError) {
      if (error.detail) console.warn(`[gateway] ${requestId} ${error.code}: ${error.detail}`)
      return errorResponse(error, requestId)
    }
    console.error(`[gateway] ${requestId}`, error)
    return errorResponse(new GatewayError('upstream_error', 'internal_error', '网关内部错误'), requestId)
  }
}

/** GET /v1/models：令牌可用的别名 */
export function handleModels(req: NextRequest): Response {
  const requestId = requestIdOf(req)
  try {
    const auth = authenticate(req.headers.get('authorization'), clientIp(req))
    const allowed = new Set(parseJsonArray(auth.token.models))
    const aliases = listAliases(auth.app.id).filter((a) => allowed.has(a.name))
    return Response.json(
      {
        object: 'list',
        data: aliases.map((a) => ({ id: a.name, object: 'model', created: auth.app.created_at, owned_by: 'conduit' })),
      },
      { headers: { 'X-Request-Id': requestId } }
    )
  } catch (error) {
    if (error instanceof GatewayError) {
      if (error.detail) console.warn(`[gateway] ${requestId} ${error.code}: ${error.detail}`)
      return errorResponse(error, requestId)
    }
    throw error
  }
}
