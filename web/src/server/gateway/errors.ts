/**
 * 网关对调用方的统一错误格式（OpenAI 风格）：{ error: { type, code, message } }。
 *
 * type 区分调用方要给出的不同提示（见 Vita 的 Provider 集成规范）：
 * - authentication_error（401）：令牌无效、过期、禁用，或来源 IP 不允许。具体原因只写服务端日志
 * - invalid_request_error（400）：参数不合法、模型别名不可用、别名的上游不提供所调的接口
 * - insufficient_quota（429）：令牌或应用额度用尽
 * - upstream_unavailable（503）：别名指向的上游已停用
 * - upstream_error（502）：上游报错或连不上
 * - upstream_timeout（504）：上游超时
 */
export type GatewayErrorType =
  | 'authentication_error'
  | 'invalid_request_error'
  | 'insufficient_quota'
  | 'upstream_unavailable'
  | 'upstream_error'
  | 'upstream_timeout'

const STATUS: Record<GatewayErrorType, number> = {
  authentication_error: 401,
  invalid_request_error: 400,
  insufficient_quota: 429,
  upstream_unavailable: 503,
  upstream_error: 502,
  upstream_timeout: 504,
}

export class GatewayError extends Error {
  readonly status: number

  constructor(
    readonly type: GatewayErrorType,
    readonly code: string,
    message: string,
    /** 只写服务端日志的细节，不返回给调用方 */
    readonly detail?: string
  ) {
    super(message)
    this.status = STATUS[type]
  }
}

export function errorBody(error: GatewayError) {
  return { error: { type: error.type, code: error.code, message: error.message } }
}

export function errorResponse(error: GatewayError, requestId: string): Response {
  return Response.json(errorBody(error), {
    status: error.status,
    headers: { 'X-Request-Id': requestId },
  })
}
