#!/usr/bin/env node
/**
 * 管理接口冒烟测试：应用、别名、上游、令牌、日志走一遍，含应当失败的情况。
 * 建的数据都以 smoke- 开头，结束时删掉。
 *
 *   pnpm dev   # 另开一个终端
 *   node scripts/api-smoke.mjs [http://localhost:3020] [密码]
 */
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:3020'
const USERNAME = process.env.ADMIN_USERNAME || 'admin'
const PASSWORD = process.argv[3] || 'conduit-dev-local'
const DB_PATH = path.resolve(process.env.CONDUIT_DATA_DIR || '.data', 'conduit.db')

let cookie = ''
async function call(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const session = res.headers.getSetCookie().find((c) => c.startsWith('conduit_session='))
  if (session) cookie = session.split(';')[0]
  return { status: res.status, ...(await res.json().catch(() => ({}))) }
}

let failed = 0
function check(label, okay, detail) {
  console.log(`${okay ? '✓' : '✗'} ${label}${okay ? '' : `  ${JSON.stringify(detail)}`}`)
  if (!okay) failed += 1
}

const login = await call('POST', '/api/user/login', { username: USERNAME, password: PASSWORD })
check('登录', login.success, login)

// 清掉上次失败遗留的数据
const db = new DatabaseSync(DB_PATH)
db.exec("PRAGMA foreign_keys = ON; DELETE FROM apps WHERE slug LIKE 'smoke-%'; DELETE FROM upstreams WHERE name LIKE 'smoke-%';")

// ---------------------------------------------------------------------------
console.log('\n应用')

const badSlug = await call('POST', '/api/user', { username: 'Smoke App', quota: 0 })
check('标识不合法被拒', !badSlug.success, badSlug)

const app = await call('POST', '/api/user', {
  username: 'smoke-app',
  display_name: 'Smoke',
  quota: 1000,
  quota_period: 'month',
})
check('创建应用', app.success && app.data.quota === 1000 && app.data.quota_period === 'month', app)
const appId = app.data?.id

const dup = await call('POST', '/api/user', { username: 'smoke-app' })
check('标识重复被拒', !dup.success && dup.message.includes('已存在'), dup)

const renamed = await call('PUT', '/api/user', { id: appId, username: 'smoke-other' })
check('标识不能修改', !renamed.success, renamed)

const updated = await call('PUT', '/api/user', { id: appId, username: 'smoke-app', quota: 2000, remark: 'r' })
check('修改额度和备注', updated.success && updated.data.quota === 2000 && updated.data.remark === 'r', updated)

const disabled = await call('POST', '/api/user/manage', { id: appId, action: 'disable' })
check('禁用应用', disabled.success && disabled.data.status === 2, disabled)
await call('POST', '/api/user/manage', { id: appId, action: 'enable' })

const search = await call('GET', '/api/user/search?keyword=smoke')
check('搜索应用', search.data?.items?.some((a) => a.id === appId), search)

// ---------------------------------------------------------------------------
console.log('\n上游')

const noKey = await call('POST', '/api/channel', {
  mode: 'single',
  channel: { name: 'smoke-up', base_url: 'https://example.com/v1' },
})
check('没填密钥被拒', !noKey.success, noKey)

const badMode = await call('POST', '/api/channel', {
  mode: 'single',
  channel: { name: 'smoke-up', base_url: 'https://example.com/v1', key: 'sk-x', responses_mode: 'chat' },
})
check('Responses 方式不合法被拒', !badMode.success, badMode)

const upstream = await call('POST', '/api/channel', {
  mode: 'single',
  channel: {
    name: 'smoke-up',
    base_url: 'https://example.com/v1/',
    key: 'sk-upstream-secret-1234',
    models: 'model-a,model-b',
  },
})
check('创建上游', upstream.success && upstream.data.key === '' && upstream.data.key_last4 === '1234', upstream)
check('新建上游默认不提供 Responses', upstream.data?.responses_mode === 'none', upstream.data?.responses_mode)
const upstreamId = upstream.data?.id
check('地址去掉结尾斜杠', upstream.data?.base_url === 'https://example.com/v1', upstream.data?.base_url)
check('新建时默认启用', upstream.data?.status === 1, upstream.data?.status)

const stored = db.prepare('SELECT key_enc FROM upstreams WHERE id = ?').get(upstreamId)
check('库里的上游密钥是密文', stored && !stored.key_enc.includes('upstream-secret') && stored.key_enc.startsWith('v1:'), stored)

const keepKey = await call('PUT', '/api/channel', { id: upstreamId, name: 'smoke-up', key: '', remark: 'x' })
const after = db.prepare('SELECT key_enc FROM upstreams WHERE id = ?').get(upstreamId)
check('编辑时密钥留空不改', keepKey.success && after.key_enc === stored.key_enc, keepKey)

const copied = await call('POST', `/api/channel/copy/${upstreamId}?suffix=-copy`)
check('复制上游', copied.success, copied)
const copyId = copied.data?.id

// ---------------------------------------------------------------------------
console.log('\n别名')

const badAlias = await call('PUT', `/api/app/${appId}/aliases`, {
  aliases: [{ name: 'Smoke Chat', upstream_id: upstreamId, upstream_model: 'model-a' }],
})
check('别名不合法被拒', !badAlias.success, badAlias)

const noUpstream = await call('PUT', `/api/app/${appId}/aliases`, {
  aliases: [{ name: 'smoke-chat', upstream_id: 999999, upstream_model: 'model-a' }],
})
check('上游不存在被拒', !noUpstream.success, noUpstream)

const aliases = await call('PUT', `/api/app/${appId}/aliases`, {
  aliases: [
    { name: 'smoke-chat', upstream_id: upstreamId, upstream_model: 'model-a' },
    { name: 'smoke-fast', upstream_id: copyId, upstream_model: 'model-b' },
  ],
})
check('保存别名', aliases.success && aliases.data.length === 2, aliases)

const models = await call('GET', `/api/user/models?app_id=${appId}`)
check('按应用列出别名', JSON.stringify(models.data) === '["smoke-chat","smoke-fast"]', models)

const delCopy = await call('DELETE', `/api/channel/${copyId}`)
check('有别名指向的上游不能删', !delCopy.success && delCopy.message.includes('别名'), delCopy)

// ---------------------------------------------------------------------------
console.log('\n令牌')

const noName = await call('POST', '/api/token', { user_id: appId, name: ' ' })
check('没填名称被拒', !noName.success, noName)

const token = await call('POST', '/api/token', { user_id: appId, name: 'smoke-t', expired_time: -1 })
const key = token.data?.key
check('创建令牌并返回一次明文', token.success && /^[0-9A-Za-z]{48}$/.test(key), token)
const tokenId = token.data?.id

const row = db.prepare('SELECT key_hash FROM tokens WHERE id = ?').get(tokenId)
check('库里只存哈希', row?.key_hash === createHash('sha256').update(key).digest('hex'), row)

const got = await call('GET', `/api/token/${tokenId}`)
check(
  '查询时只返回打码的密钥',
  got.data?.key === `${key.slice(0, 4)}****${key.slice(-4)}` && got.data.expired_time === -1,
  got.data
)

const reveal = await call('POST', `/api/token/${tokenId}/key`)
check('不能再查明文', !reveal.success && reveal.message.includes('重新生成'), reveal)

const regen = await call('POST', `/api/token/${tokenId}/regenerate`)
check('重新生成返回新明文', regen.success && regen.data.key !== key && /^[0-9A-Za-z]{48}$/.test(regen.data.key), regen)

const status = await call('PUT', '/api/token/?status_only=true', { id: tokenId, status: 2 })
check('禁用令牌', status.success && status.data.status === 2, status)

const edit = await call('PUT', '/api/token', {
  id: tokenId,
  name: 'smoke-t2',
  expired_time: Math.floor(Date.now() / 1000) - 10,
})
check('编辑后仍是禁用（禁用优先于过期）', edit.success && edit.data.status === 2 && edit.data.name === 'smoke-t2', edit.data)
await call('PUT', '/api/token/?status_only=true', { id: tokenId, status: 1 })
const expired = await call('GET', `/api/token/${tokenId}`)
check('启用后显示为已过期', expired.data?.status === 3, expired.data)

const list = await call('GET', '/api/token/search?keyword=smoke-app')
check('按应用搜令牌', list.data?.items?.some((t) => t.id === tokenId && t.app_name === 'smoke-app'), list)

const byApp = await call('GET', `/api/token?app_id=${appId}`)
check('按应用 id 列令牌', byApp.data?.items?.length === 1 && byApp.data.items[0].id === tokenId, byApp.data)

// ---------------------------------------------------------------------------
console.log('\n日志和看板')

db.prepare(
  `INSERT INTO usage_logs (request_id, app_id, app_slug, token_id, token_name, alias, upstream_id, upstream_name,
     upstream_model, input_tokens, output_tokens, is_stream, created_at)
   VALUES ('smoke-req', ?, 'smoke-app', ?, 'smoke-t2', 'smoke-chat', ?, 'smoke-up', 'model-a', 100, 20, 1, ?)`
).run(appId, tokenId, upstreamId, Math.floor(Date.now() / 1000))

const logs = await call('GET', '/api/log?username=smoke-app')
const log = logs.data?.items?.[0]
check('日志按应用筛选', logs.data?.total === 1 && log.quota === 120 && log.model_name === 'smoke-chat', logs.data)
const stat = await call('GET', '/api/log/stat?username=smoke-app')
check('日志统计', stat.data?.quota === 120, stat)
const now = Math.floor(Date.now() / 1000)
const chart = await call('GET', `/api/data?start_timestamp=${now - 3600}&end_timestamp=${now + 60}&username=smoke-app`)
check('看板按小时聚合', chart.data?.[0]?.token_used === 120 && chart.data[0].model_name === 'smoke-chat', chart)
const channel = await call('GET', `/api/channel/${upstreamId}`)
check('上游累计用量', channel.data?.used_quota === 120, channel.data?.used_quota)

// ---------------------------------------------------------------------------
console.log('\n清理')

const delApp = await call('DELETE', `/api/user/${appId}`)
check('删除应用连带删掉令牌和别名', delApp.success && !db.prepare('SELECT 1 FROM tokens WHERE id = ?').get(tokenId), delApp)
const delUp = await call('POST', '/api/channel/batch', { ids: [upstreamId, copyId] })
check('别名删掉后上游可以删', delUp.success && delUp.data === 2, delUp)
db.prepare("DELETE FROM usage_logs WHERE request_id = 'smoke-req'").run()

console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
