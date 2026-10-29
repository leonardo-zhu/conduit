/**
 * 事件：网关发现的、需要管理员看一眼的情况，显示在顶栏铃铛里。
 *
 * 同一类型、同一对象的事件，在上一条还没读、或者一小时内又出现时，合并到上一条（次数加 1），
 * 不另起一条，免得一个上游挂掉刷满列表。30 天前的事件在写入新事件时顺手清掉。
 * 新的一条会推到 Telegram（配置了的话，见 telegram.ts）。
 */
import { db, nowSeconds } from './db'
import { pushEventToTelegram } from './telegram'

export type EventKind =
  | 'upstream_auth' // 上游返回 401 / 403，多半是密钥失效或没有权限
  | 'upstream_rate_limit' // 上游返回 429
  | 'upstream_failing' // 上游连续失败（5xx、超时、连不上）
  | 'quota_warning' // 应用或令牌的额度用到 80%
  | 'quota_exhausted' // 额度用尽，之后被拒的请求也计入次数
  | 'error_rate' // 应用最近 10 分钟的上游类失败占一半以上

export type EventLevel = 'warning' | 'error'
export type EventSubject = 'upstream' | 'app' | 'token'

export interface EventRow {
  id: number
  kind: EventKind
  level: EventLevel
  subject_type: EventSubject
  subject_id: number
  subject_name: string
  title: string
  detail: string
  link: string
  count: number
  first_at: number
  last_at: number
  read_at: number
}

/** 推送用的“名称：值”一行 */
export type EventField = [label: string, value: string]

export interface EventInput {
  kind: EventKind
  level: EventLevel
  subjectType: EventSubject
  subjectId: number
  subjectName: string
  title: string
  detail?: string
  link?: string
  /** 只用于推送排版，不入库：逐行列出的关键信息，和附在末尾的上游原始响应 */
  fields?: EventField[]
  raw?: string
}

const MERGE_WINDOW = 3600
const RETENTION = 30 * 86400

/** 记一条事件；返回 true 表示是新的一条（不是合并进已有的） */
export function raiseEvent(input: EventInput): boolean {
  const now = nowSeconds()
  const existing = db()
    .prepare(
      `SELECT id FROM events WHERE kind = ? AND subject_type = ? AND subject_id = ? AND (read_at = 0 OR last_at >= ?)
       ORDER BY last_at DESC LIMIT 1`
    )
    .get(input.kind, input.subjectType, input.subjectId, now - MERGE_WINDOW) as { id: number } | undefined

  if (existing) {
    db()
      .prepare(
        `UPDATE events SET count = count + 1, last_at = ?, level = ?, subject_name = ?, title = ?, detail = ?, link = ?
         WHERE id = ?`
      )
      .run(now, input.level, input.subjectName, input.title, input.detail ?? '', input.link ?? '', existing.id)
    return false
  }

  db().prepare('DELETE FROM events WHERE last_at < ?').run(now - RETENTION)
  db()
    .prepare(
      `INSERT INTO events (kind, level, subject_type, subject_id, subject_name, title, detail, link, first_at, last_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.kind,
      input.level,
      input.subjectType,
      input.subjectId,
      input.subjectName,
      input.title,
      input.detail ?? '',
      input.link ?? '',
      now,
      now
    )
  return true
}

/**
 * 记事件不能影响请求本身：写库出错只打日志。新的一条推到 Telegram。
 * 网关里都通过这个调用
 */
export function safeRaiseEvent(input: EventInput) {
  try {
    if (raiseEvent(input)) pushEventToTelegram(input)
  } catch (error) {
    console.error('[events] 记录事件失败', error)
  }
}
