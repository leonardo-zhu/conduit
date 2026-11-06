/**
 * 配置变更记录：后台对应用、别名、密钥、服务商、Passkey 的增删改各记一条，
 * 回答“这个别名什么时候、从哪改成了哪”。只有一个管理员，所以不算严格的审计，只是给自己留底。
 *
 * - 谁改的：会话的登录方式和 IP。/api/* 的入口用 runAsActor 包住每个请求，接口里不用传。
 * - 改了什么：每个字段一行“改前 → 改后”，已经格式化成界面上的样子（状态写“启用 / 停用”等）；
 *   时间类的值留 unix 秒，由前端按浏览器时区显示。
 * - 不记：查看类操作、网关自己写的用量和额度、事件已读。密钥明文从不出现，只记后 4 位。
 * - 写记录出错只打日志，不影响操作本身。
 */
import { AsyncLocalStorage } from 'node:async_hooks'

import { db, nowSeconds } from './db'

export interface Actor {
  method: string
  ip: string
}

const actorStore = new AsyncLocalStorage<Actor>()

export function runAsActor<T>(actor: Actor, run: () => T): T {
  return actorStore.run(actor, run)
}

export type ChangeSubject = 'app' | 'alias' | 'token' | 'upstream' | 'passkey'
export type ChangeAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'enable'
  | 'disable'
  | 'regenerate_key'
  | 'copy'

export interface FieldChange {
  label: string
  from?: string
  to?: string
  /** from / to 是 unix 秒（-1 表示永不），前端格式化 */
  time?: true
}

export interface ChangeRow {
  id: number
  at: number
  actor: string
  ip: string
  subject_type: ChangeSubject
  subject_id: string
  subject_name: string
  action: ChangeAction
  changes: string
}

export function recordChange(input: {
  subjectType: ChangeSubject
  subjectId: number | string
  subjectName: string
  action: ChangeAction
  changes?: FieldChange[]
}) {
  // 修改了但没有实际变化（原样保存）的不记
  if (input.action === 'update' && !input.changes?.length) return
  const actor = actorStore.getStore()
  try {
    db()
      .prepare(
        `INSERT INTO config_changes (at, actor, ip, subject_type, subject_id, subject_name, action, changes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        nowSeconds(),
        actor?.method ?? '',
        actor?.ip ?? '',
        input.subjectType,
        String(input.subjectId),
        input.subjectName,
        input.action,
        JSON.stringify(input.changes ?? [])
      )
  } catch (error) {
    console.error(`[changes] 写变更记录失败：${String(error)}`)
  }
}

// ---------------------------------------------------------------------------
// 字段对比
// ---------------------------------------------------------------------------

type Formatter = (value: unknown) => string

export interface FieldSpec {
  label: string
  format?: Formatter
  time?: true
}

const str: Formatter = (v) => (v === undefined || v === null ? '' : String(v))

export const fmt = {
  status: ((v) => (Number(v) === 1 ? '启用' : '停用')) as Formatter,
  quota: ((v) => (Number(v) === 0 ? '不限' : Number(v).toLocaleString('en-US'))) as Formatter,
  quotaPeriod: ((v) => (v === 'month' ? '每月重置' : '不重置')) as Formatter,
  responsesMode: ((v) => ({ native: '原生', convert: '网关转换', none: '不提供' })[String(v)] ?? str(v)) as Formatter,
}

/**
 * 按 specs 里列的字段对比改前改后，只返回有变化的。
 * after 里没有的字段视为没改（接口的部分更新）；before 为空表示新建，只列有值的字段。
 */
export function diffFields(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  specs: Record<string, FieldSpec>
): FieldChange[] {
  const out: FieldChange[] = []
  for (const [key, spec] of Object.entries(specs)) {
    if (!(key in after)) continue
    const format = spec.time ? str : (spec.format ?? str)
    const to = format(after[key])
    if (!before) {
      if (to !== '') out.push({ label: spec.label, to, ...(spec.time ? { time: true } : {}) })
      continue
    }
    const from = format(before[key])
    if (from !== to) out.push({ label: spec.label, from, to, ...(spec.time ? { time: true } : {}) })
  }
  return out
}

/** 模型列表这类 JSON 数组：只写新增和移除了哪些 */
export function diffList(label: string, before: string[], after: string[]): FieldChange[] {
  const added = after.filter((m) => !before.includes(m))
  const removed = before.filter((m) => !after.includes(m))
  if (!added.length && !removed.length) return []
  const parts = []
  if (added.length) parts.push(`新增 ${added.join(', ')}`)
  if (removed.length) parts.push(`移除 ${removed.join(', ')}`)
  return [{ label, to: parts.join('；') }]
}

export function parseList(json: unknown): string[] {
  try {
    const value = JSON.parse(String(json ?? '[]'))
    return Array.isArray(value) ? value.map(String) : []
  } catch {
    return []
  }
}
