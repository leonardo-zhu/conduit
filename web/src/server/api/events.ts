/**
 * 顶栏铃铛的事件列表和已读状态。事件由网关写入（见 ../gateway/alerts.ts）。
 */
import { db, nowSeconds } from '../db'
import type { EventRow } from '../events'
import { fail, ok } from '../router'
import { route } from './registry'

/** 列表只给最近的 50 条，铃铛里看不了更多 */
const LIST_LIMIT = 50

route('GET', '/api/events', () => {
  const items = db()
    .prepare('SELECT * FROM events ORDER BY last_at DESC, id DESC LIMIT ?')
    .all(LIST_LIMIT) as unknown as EventRow[]
  const { unread } = db().prepare('SELECT COUNT(*) AS unread FROM events WHERE read_at = 0').get() as {
    unread: number
  }
  return ok({ items, unread })
})

route('POST', '/api/events/read_all', () => {
  db().prepare('UPDATE events SET read_at = ? WHERE read_at = 0').run(nowSeconds())
  return ok()
})

route('POST', '/api/events/:id/read', ({ params }) => {
  const changes = db()
    .prepare('UPDATE events SET read_at = ? WHERE id = ? AND read_at = 0')
    .run(nowSeconds(), Number(params.id)).changes
  const exists = changes > 0 || db().prepare('SELECT 1 FROM events WHERE id = ?').get(Number(params.id))
  return exists ? ok() : fail('事件不存在', 404)
})
