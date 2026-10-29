/**
 * 请求结束后记账：写一条用量记录，同时给令牌和应用扣额度。
 *
 * 单进程，一个 SQLite 事务里完成，同一令牌的并发请求不会少扣。
 * 只记请求到达上游之后的结果；鉴权、额度不足等在网关就被拒绝的请求不记。
 */
import { db, nowSeconds, transaction } from '../db'
import type { GatewayAuth, RouteTarget } from './context'

export interface UsageEntry {
  requestId: string
  auth: GatewayAuth
  target: RouteTarget
  isStream: boolean
  statusCode: number
  /** 空字符串表示成功 */
  error: string
  inputTokens: number
  outputTokens: number
  estimated: boolean
  firstTokenMs: number
  durationMs: number
  ip: string
}

export function recordUsage(entry: UsageEntry) {
  const charge = entry.inputTokens + entry.outputTokens
  const now = nowSeconds()
  transaction(() => {
    db()
      .prepare(
        `INSERT INTO usage_logs (request_id, app_id, app_slug, token_id, token_name, alias, upstream_id, upstream_name,
           upstream_model, input_tokens, output_tokens, is_stream, status_code, error, first_token_ms, duration_ms,
           estimated, ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.requestId,
        entry.auth.app.id,
        entry.auth.app.slug,
        entry.auth.token.id,
        entry.auth.token.name,
        entry.target.alias,
        entry.target.upstream.id,
        entry.target.upstream.name,
        entry.target.upstreamModel,
        entry.inputTokens,
        entry.outputTokens,
        entry.isStream ? 1 : 0,
        entry.statusCode,
        entry.error,
        entry.firstTokenMs,
        entry.durationMs,
        entry.estimated ? 1 : 0,
        entry.ip,
        now
      )
    db()
      .prepare('UPDATE tokens SET used = used + ?, last_used_at = ? WHERE id = ?')
      .run(charge, now, entry.auth.token.id)
    db()
      .prepare('UPDATE apps SET used = used + ?, request_count = request_count + ? WHERE id = ?')
      .run(charge, entry.error ? 0 : 1, entry.auth.app.id)
  })
}

/**
 * 拿不到上游 usage 时的粗略估算：按字符数折算，中英文混合大约 2 个字符一个 token。
 * 记录上会标“估算”，以上游控制台的账单为准。
 */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 2)
}
