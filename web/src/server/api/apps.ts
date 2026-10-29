/**
 * 应用：预算和隔离的单位。后台沿用 NewAPI 的“用户”接口（/api/user），
 * 字段按 NewAPI 用户的格式返回：username 是应用标识，quota 是总额度（0 不限）。
 *
 * 别名属于应用，用 Conduit 自己的接口 /api/app/:id/aliases 整体读写。
 */
import {
  db,
  isForeignKeyViolation,
  isUniqueViolation,
  nowSeconds,
  parseJsonArray,
  transaction,
} from '../db'
import { fail, ok, pageParams, type ApiRequest } from '../router'
import { route } from './registry'

export interface AppRow {
  id: number
  slug: string
  name: string
  status: number
  quota: number
  quota_period: 'none' | 'month'
  used: number
  period_start: number
  request_count: number
  remark: string
  created_at: number
}

export const APP_STATUS = { ENABLED: 1, DISABLED: 2 } as const
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/
const ALIAS_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

function monthStart(now = new Date()): number {
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000)
}

/** 按月重置的应用：进入新的月份后清零已用。读和扣减前都先调一次 */
export function rolloverAppPeriods() {
  const start = monthStart()
  db()
    .prepare(`UPDATE apps SET used = 0, period_start = ? WHERE quota_period = 'month' AND period_start < ?`)
    .run(start, start)
}

/** 转成 NewAPI 用户的格式 */
function toUser(app: AppRow) {
  return {
    id: app.id,
    username: app.slug,
    display_name: app.name,
    role: 1,
    status: app.status,
    group: 'default',
    quota: app.quota,
    used_quota: app.used,
    quota_period: app.quota_period,
    request_count: app.request_count,
    remark: app.remark,
    created_at: app.created_at,
    last_login_at: 0,
  }
}

export function getApp(id: number): AppRow | undefined {
  return db().prepare('SELECT * FROM apps WHERE id = ?').get(id) as AppRow | undefined
}

function listApps(query: URLSearchParams) {
  rolloverAppPeriods()
  const { page, size, offset } = pageParams(query)
  const keyword = (query.get('keyword') ?? '').trim()
  const where = keyword ? 'WHERE slug LIKE ? OR name LIKE ?' : ''
  const args = keyword ? [`%${keyword}%`, `%${keyword}%`] : []
  const { total } = db().prepare(`SELECT COUNT(*) AS total FROM apps ${where}`).get(...args) as { total: number }
  const rows = db()
    .prepare(`SELECT * FROM apps ${where} ORDER BY id LIMIT ? OFFSET ?`)
    .all(...args, size, offset) as unknown as AppRow[]
  return ok({ items: rows.map(toUser), total, page, page_size: size })
}

interface AppInput {
  username?: unknown
  display_name?: unknown
  quota?: unknown
  quota_period?: unknown
  remark?: unknown
}

/** 校验并整理表单；partial 为 true 时只处理传了的字段 */
function readAppInput(body: unknown, partial: boolean) {
  const input = (body ?? {}) as AppInput
  const fields: Partial<Pick<AppRow, 'slug' | 'name' | 'quota' | 'quota_period' | 'remark'>> = {}

  if (!partial || input.username !== undefined) {
    const slug = typeof input.username === 'string' ? input.username.trim() : ''
    if (!SLUG_PATTERN.test(slug)) return { error: '应用标识只能用小写字母、数字和连字符，最长 32 位' }
    fields.slug = slug
  }
  if (!partial || input.display_name !== undefined) {
    const name = typeof input.display_name === 'string' ? input.display_name.trim() : ''
    fields.name = name || fields.slug || ''
  }
  if (!partial || input.quota !== undefined) {
    const quota = Number(input.quota ?? 0)
    if (!Number.isInteger(quota) || quota < 0) return { error: '额度必须是非负整数' }
    fields.quota = quota
  }
  if (!partial || input.quota_period !== undefined) {
    const period = input.quota_period ?? 'none'
    if (period !== 'none' && period !== 'month') return { error: '额度周期只能是不重置或按月' }
    fields.quota_period = period
  }
  if (!partial || input.remark !== undefined) {
    fields.remark = typeof input.remark === 'string' ? input.remark.slice(0, 255) : ''
  }
  return { fields }
}

route('GET', '/api/user', ({ query }) => listApps(query))
route('GET', '/api/user/search', ({ query }) => listApps(query))

route('GET', '/api/user/:id', ({ params }) => {
  rolloverAppPeriods()
  const app = getApp(Number(params.id))
  return app ? ok(toUser(app)) : fail('应用不存在')
})

route('POST', '/api/user', ({ body }) => {
  const { fields, error } = readAppInput(body, false)
  if (error || !fields) return fail(error ?? '参数错误')
  const now = nowSeconds()
  try {
    const result = db()
      .prepare(
        `INSERT INTO apps (slug, name, quota, quota_period, period_start, remark, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(fields.slug!, fields.name!, fields.quota!, fields.quota_period!, monthStart(), fields.remark!, now)
    return ok(toUser(getApp(Number(result.lastInsertRowid))!))
  } catch (e) {
    if (isUniqueViolation(e)) return fail('应用标识已存在')
    throw e
  }
})

route('PUT', '/api/user', ({ body }) => {
  const id = Number((body as { id?: unknown })?.id)
  const app = getApp(id)
  if (!app) return fail('应用不存在')
  const { fields, error } = readAppInput(body, true)
  if (error || !fields) return fail(error ?? '参数错误')
  // 应用标识是别名和令牌名的前缀，改了会和已有的对不上，不允许改
  if (fields.slug && fields.slug !== app.slug) return fail('应用标识创建后不能修改')
  delete fields.slug
  const entries = Object.entries(fields)
  if (entries.length) {
    db()
      .prepare(`UPDATE apps SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...entries.map(([, v]) => v as string | number), id)
  }
  return ok(toUser(getApp(id)!))
})

route('DELETE', '/api/user/:id', ({ params }) => {
  const result = db().prepare('DELETE FROM apps WHERE id = ?').run(Number(params.id))
  return result.changes ? ok() : fail('应用不存在')
})

// 启用 / 禁用（NewAPI 还有提升 / 降级，Conduit 的应用没有角色）
route('POST', '/api/user/manage', ({ body }) => {
  const { id, action } = (body ?? {}) as { id?: unknown; action?: unknown }
  const app = getApp(Number(id))
  if (!app) return fail('应用不存在')
  const status =
    action === 'enable' ? APP_STATUS.ENABLED : action === 'disable' ? APP_STATUS.DISABLED : undefined
  if (!status) return fail('不支持的操作')
  db().prepare('UPDATE apps SET status = ? WHERE id = ?').run(status, app.id)
  return ok({ role: 1, status })
})

// ---------------------------------------------------------------------------
// 别名
// ---------------------------------------------------------------------------

export interface AliasRow {
  id: number
  app_id: number
  name: string
  upstream_id: number
  upstream_model: string
}

export function listAliases(appId?: number): (AliasRow & { upstream_name: string })[] {
  const sql = `SELECT a.*, u.name AS upstream_name FROM aliases a JOIN upstreams u ON u.id = a.upstream_id
               ${appId ? 'WHERE a.app_id = ?' : ''} ORDER BY a.app_id, a.name`
  return db()
    .prepare(sql)
    .all(...(appId ? [appId] : [])) as unknown as (AliasRow & { upstream_name: string })[]
}

route('GET', '/api/app/:id/aliases', ({ params }) => {
  const app = getApp(Number(params.id))
  return app ? ok(listAliases(app.id)) : fail('应用不存在')
})

/**
 * 整体替换一个应用的别名。令牌白名单里引用了被删掉的别名时拒绝，
 * 免得令牌悄悄失去可用模型。
 */
route('PUT', '/api/app/:id/aliases', ({ params, body }: ApiRequest) => {
  const app = getApp(Number(params.id))
  if (!app) return fail('应用不存在')
  const items = (body as { aliases?: unknown })?.aliases
  if (!Array.isArray(items)) return fail('参数错误')

  const aliases: Omit<AliasRow, 'id' | 'app_id'>[] = []
  for (const item of items as Record<string, unknown>[]) {
    const name = typeof item?.name === 'string' ? item.name.trim() : ''
    const upstreamModel = typeof item?.upstream_model === 'string' ? item.upstream_model.trim() : ''
    const upstreamId = Number(item?.upstream_id)
    if (!ALIAS_PATTERN.test(name)) return fail(`别名“${name}”不合法：只能用小写字母、数字和 . _ -`)
    if (!upstreamModel) return fail(`别名“${name}”没有填上游模型`)
    if (aliases.some((a) => a.name === name)) return fail(`别名“${name}”重复`)
    aliases.push({ name, upstream_id: upstreamId, upstream_model: upstreamModel })
  }

  const names = new Set(aliases.map((a) => a.name))
  const tokens = db().prepare('SELECT name, models FROM tokens WHERE app_id = ?').all(app.id) as {
    name: string
    models: string
  }[]
  for (const token of tokens) {
    const missing = parseJsonArray(token.models).filter((m) => !names.has(m))
    if (missing.length) {
      return fail(`令牌“${token.name}”还在用 ${missing.join('、')}，先从令牌里去掉再删除别名`)
    }
  }

  try {
    transaction(() => {
      db().prepare('DELETE FROM aliases WHERE app_id = ?').run(app.id)
      const insert = db().prepare(
        'INSERT INTO aliases (app_id, name, upstream_id, upstream_model) VALUES (?, ?, ?, ?)'
      )
      for (const a of aliases) insert.run(app.id, a.name, a.upstream_id, a.upstream_model)
    })
  } catch (e) {
    if (isForeignKeyViolation(e)) return fail('选择的上游不存在')
    throw e
  }
  return ok(listAliases(app.id))
})

// 令牌表单的模型下拉：传 app_id 时只列该应用的别名
route('GET', '/api/user/models', ({ query }) => {
  const appId = Number(query.get('app_id')) || undefined
  return ok([...new Set(listAliases(appId).map((a) => a.name))])
})
