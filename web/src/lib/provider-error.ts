/**
 * Conduit: 服务商错误正文的展示。
 *
 * 常见格式有两种：
 *   OpenAI 风格（火山方舟、OpenAI 和大多数兼容服务商）：{"error":{"code","message","type","param"}}
 *   Anthropic 风格：{"type":"error","error":{"type","message"}}
 *
 * 能整段解析就缩进排版；解析不了（多半是网关记日志时截断了正文）就按字段名把
 * code / type / message 抠出来。服务端（Telegram）和后台铃铛共用。
 */

export type ProviderError =
  | { kind: 'json'; text: string }
  | { kind: 'fields'; fields: [string, string][] }
  | { kind: 'text'; text: string }

const FIELDS: [label: string, key: string][] = [
  ['code', 'code'],
  ['type', 'type'],
  ['message', 'message'],
]

/** 取第一个 "key":"value"，允许 value 没有结尾引号（被截断） */
function pickField(text: string, key: string): string | undefined {
  const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(text)
  if (!match?.[1]) return undefined
  let value = match[1]
  try {
    value = JSON.parse(`"${value}"`)
  } catch {
    // 截断在转义符中间之类，原样用
  }
  // Anthropic 外层的 "type":"error" 没有信息量
  return key === 'type' && value === 'error' ? undefined : value
}

export function describeProviderError(raw: string): ProviderError {
  const text = raw.trim()
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object') {
      return { kind: 'json', text: JSON.stringify(parsed, null, 2) }
    }
  } catch {
    // 不是完整 JSON
  }
  if (text.startsWith('{')) {
    const fields: [string, string][] = []
    for (const [label, key] of FIELDS) {
      const value = key === 'type' ? pickTypeField(text) : pickField(text, key)
      if (value) fields.push([label, value])
    }
    if (fields.length) return { kind: 'fields', fields }
  }
  return { kind: 'text', text }
}

/** type 可能先出现外层的 "type":"error"（Anthropic），跳过它再找一次 */
function pickTypeField(text: string): string | undefined {
  const first = pickField(text, 'type')
  if (first) return first
  const rest = text.replace(/"type"\s*:\s*"error"/, '')
  return pickField(rest, 'type')
}

export interface ErrorSummary {
  /** 服务商返回的 HTTP 状态码；流内错误、连不上、超时等没有 */
  status?: string
  /** 错误码：code，没有就用 type */
  code?: string
  /** 一句话说明：message，没有就是去掉前缀后的原文 */
  message: string
}

/** 网关记的“服务商返回 400：{...}”，改名前是“上游返回” */
const RETURNED_PREFIX = /^(?:服务商|上游)返回 (\d{3})：/

/**
 * 错误日志的一行摘要，给使用日志表格这类放不下全文的地方用：
 * “服务商返回 400：{"error":{"code":"X","message":"Y"}}” → { status: '400', code: 'X', message: 'Y' }。
 * 不是服务商 JSON 报错（连不上、超时、流内错误等）时 message 就是原文。
 */
export function summarizeProviderError(raw: string): ErrorSummary {
  const text = raw.trim()
  const prefix = RETURNED_PREFIX.exec(text)
  const status = prefix?.[1]
  const body = prefix ? text.slice(prefix[0].length).trim() : text
  if (!body.startsWith('{')) return { status, message: body || text }

  let code: string | undefined
  let message: string | undefined
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    const inner = (parsed.error && typeof parsed.error === 'object' ? parsed.error : parsed) as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : undefined)
    code = str(inner.code) ?? str(inner.type)
    message = str(inner.message) ?? str(parsed.message)
  } catch {
    // 旧日志的正文截在 300 字，按字段名抠
    code = pickField(body, 'code') ?? pickTypeField(body)
    message = pickField(body, 'message')
  }
  return { status, code, message: message || body }
}
