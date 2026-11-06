/**
 * 配置变更记录的列表（后台“变更记录”页）。记录由各管理接口写入，见 ../changes.ts。
 */
import type { ChangeRow } from '../changes'
import { db } from '../db'
import { ok, pageParams } from '../router'
import { route } from './registry'

const SUBJECT_TYPES = new Set(['app', 'alias', 'token', 'upstream', 'passkey'])

route('GET', '/api/changes', ({ query }) => {
  const { page, size, offset } = pageParams(query, 50)
  const conditions: string[] = []
  const args: (string | number)[] = []
  const type = query.get('subject_type') ?? ''
  if (SUBJECT_TYPES.has(type)) {
    conditions.push('subject_type = ?')
    args.push(type)
  }
  const keyword = (query.get('keyword') ?? '').trim()
  if (keyword) {
    conditions.push('(subject_name LIKE ? OR changes LIKE ?)')
    args.push(`%${keyword}%`, `%${keyword}%`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const { total } = db().prepare(`SELECT COUNT(*) AS total FROM config_changes ${where}`).get(...args) as {
    total: number
  }
  const rows = db()
    .prepare(`SELECT * FROM config_changes ${where} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, size, offset) as unknown as ChangeRow[]
  const items = rows.map((row) => ({ ...row, changes: JSON.parse(row.changes) }))
  return ok({ items, total, page, page_size: size })
})
