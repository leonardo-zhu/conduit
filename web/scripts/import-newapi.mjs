#!/usr/bin/env node
/**
 * 把 NewAPI 的令牌导入 Conduit：密钥只存哈希，格式不变（sk-...），接入方不用换令牌。
 *
 * NewAPI 库里存的是令牌明文。先把 R4S 上的 /opt/conduit/new-api/data/one-api.db 拷一份出来，
 * 对拷贝运行（只读打开，不改 NewAPI 的库）。默认只打印计划，加 --apply 才写入。
 *
 *   node scripts/import-newapi.mjs ./one-api.db                       # 预览
 *   node scripts/import-newapi.mjs ./one-api.db --map root=vita       # NewAPI 用户 root 的令牌归到应用 vita
 *   node scripts/import-newapi.mjs ./one-api.db --map root=vita --apply
 *
 * 规则：
 * - 每个有令牌的 NewAPI 用户对应一个应用：--map 指定的标识，否则用用户名（转成小写、连字符）。
 *   应用不存在时创建，额度不限。
 * - NewAPI 的额度单位是“额度”，不是 token，没法换算：导入的令牌都设为不限额度，有上限的会列出来，导入后手动设。
 * - 模型白名单原样导入。白名单里的模型名就是 Conduit 的别名；应用里还没有的别名会列出来，
 *   导入前或导入后在应用里补上（补齐之前，这些令牌在后台编辑会报错）。
 * - 已删除（软删除）的令牌跳过；哈希已存在的跳过，所以可以重复运行。
 * - 禁用的令牌保持禁用；过期时间、创建和最近使用时间照搬。
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const args = process.argv.slice(2)
let source
let apply = false
const mapping = new Map()
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--apply') {
    apply = true
  } else if (args[i] === '--map') {
    const [from, to] = (args[++i] ?? '').split('=')
    if (!from || !to) throw new Error(`--map 的格式是 NewAPI用户名=应用标识，收到 ${args[i]}`)
    mapping.set(from, to)
  } else {
    source ??= args[i]
  }
}

if (!source || !existsSync(source)) {
  console.error('用法：node scripts/import-newapi.mjs <one-api.db 的拷贝> [--map 用户名=应用标识 ...] [--apply]')
  process.exit(1)
}
const targetPath = path.resolve(process.env.CONDUIT_DATA_DIR || '.data', 'conduit.db')
if (!existsSync(targetPath)) {
  console.error(`找不到 Conduit 的库 ${targetPath}：先启动一次服务让它建表，或设置 CONDUIT_DATA_DIR`)
  process.exit(1)
}

const newapi = new DatabaseSync(source, { readOnly: true })
const conduit = new DatabaseSync(targetPath)
conduit.exec('PRAGMA foreign_keys = ON')

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/
const toSlug = (username) =>
  mapping.get(username) ?? username.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
const hash = (key) => createHash('sha256').update(key.replace(/^sk-/, '')).digest('hex')
const now = Math.floor(Date.now() / 1000)

const tokens = newapi
  .prepare(
    `SELECT t.*, u.username FROM tokens t JOIN users u ON u.id = t.user_id
     WHERE t.deleted_at IS NULL ORDER BY t.id`
  )
  .all()

const plan = new Map() // slug -> { appId, exists, tokens: [] }
const skipped = []
for (const t of tokens) {
  const slug = toSlug(t.username)
  if (!SLUG_PATTERN.test(slug)) {
    skipped.push(`${t.name}：NewAPI 用户 ${t.username} 转不成合法的应用标识，用 --map 指定`)
    continue
  }
  if (conduit.prepare('SELECT 1 FROM tokens WHERE key_hash = ?').get(hash(t.key))) {
    skipped.push(`${t.name}：已导入过`)
    continue
  }
  if (!plan.has(slug)) {
    const app = conduit.prepare('SELECT id FROM apps WHERE slug = ?').get(slug)
    plan.set(slug, { appId: app?.id, from: t.username, tokens: [] })
  }
  plan.get(slug).tokens.push(t)
}

// ---------------------------------------------------------------------------
// 预览
// ---------------------------------------------------------------------------

const warnings = []
for (const [slug, entry] of plan) {
  const aliases = new Set(
    entry.appId ? conduit.prepare('SELECT name FROM aliases WHERE app_id = ?').all(entry.appId).map((r) => r.name) : []
  )
  console.log(`\n应用 ${slug}${entry.appId ? '' : '（新建）'} ← NewAPI 用户 ${entry.from}`)
  for (const t of entry.tokens) {
    const models = t.model_limits_enabled ? String(t.model_limits ?? '').split(',').map((m) => m.trim()).filter(Boolean) : []
    const status = t.status === 2 ? '禁用' : t.expired_time !== -1 && t.expired_time <= now ? '已过期' : '启用'
    console.log(`  ${t.name}  sk-${t.key.slice(0, 4)}****${t.key.slice(-4)}  ${status}  模型：${models.join(', ') || '（无）'}`)
    if (!models.length) warnings.push(`${slug}/${t.name}：没有模型白名单，导入后调用不了任何模型，需要在后台选别名`)
    const missing = models.filter((m) => !aliases.has(m))
    if (missing.length) warnings.push(`${slug}/${t.name}：应用里还没有别名 ${missing.join('、')}`)
    if (!t.unlimited_quota) warnings.push(`${slug}/${t.name}：NewAPI 里有额度上限，导入为不限，需要的话在后台重新设`)
  }
}
for (const s of skipped) console.log(`跳过 ${s}`)
if (warnings.length) {
  console.log('\n需要注意：')
  for (const w of warnings) console.log(`  - ${w}`)
}

const count = [...plan.values()].reduce((n, e) => n + e.tokens.length, 0)
if (!apply) {
  console.log(`\n预览：将导入 ${count} 个令牌。确认无误后加 --apply 写入。`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

conduit.exec('BEGIN IMMEDIATE')
try {
  const monthStart = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000)
  const insertApp = conduit.prepare(
    `INSERT INTO apps (slug, name, period_start, remark, created_at) VALUES (?, ?, ?, ?, ?)`
  )
  const insertToken = conduit.prepare(
    `INSERT INTO tokens (app_id, name, key_hash, key_prefix, key_last4, status, expires_at, quota, used, models,
       allow_ips, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`
  )
  for (const [slug, entry] of plan) {
    const appId =
      entry.appId ?? Number(insertApp.run(slug, slug, monthStart, `从 NewAPI 用户 ${entry.from} 导入`, now).lastInsertRowid)
    for (const t of entry.tokens) {
      const models = t.model_limits_enabled ? String(t.model_limits ?? '').split(',').map((m) => m.trim()).filter(Boolean) : []
      insertToken.run(
        appId,
        t.name,
        hash(t.key),
        t.key.slice(0, 4),
        t.key.slice(-4),
        t.status === 2 ? 2 : 1,
        t.expired_time ?? -1,
        JSON.stringify([...new Set(models)]),
        t.allow_ips ?? '',
        t.created_time || now,
        t.accessed_time || 0
      )
    }
  }
  conduit.exec('COMMIT')
} catch (error) {
  conduit.exec('ROLLBACK')
  throw error
}
console.log(`\n已导入 ${count} 个令牌。`)
