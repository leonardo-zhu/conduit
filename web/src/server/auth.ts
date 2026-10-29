/**
 * 管理员认证：只有一个管理员账号，不建用户表。
 *
 * - 账号和密码哈希来自环境变量（ADMIN_USERNAME / ADMIN_PASSWORD_HASH），不进仓库。
 *   哈希用 `node web/scripts/hash-password.mjs` 生成。
 * - 登录后发 HMAC 签名的 HttpOnly cookie（SESSION_SECRET 签名）。服务端不存会话：
 *   改 SESSION_SECRET 或密码哈希后重启，所有会话立即失效。
 * - 登录失败按 IP 限速。
 */
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'

import type { NextRequest } from 'next/server'

import { db } from './db'

export const SESSION_COOKIE = 'conduit_session'
/** 前端据此判断要不要尝试恢复会话（沿用 NewAPI 前端的约定），不含任何凭据 */
export const SESSION_HINT_COOKIE = 'new_api_has_session'

const SESSION_TTL_SECONDS = 7 * 86400
const ACCESS_TTL_SECONDS = 3600
const ADMIN_USER_ID = 1

interface AuthConfig {
  username: string
  passwordHash: string
  secret: string
}

export class AuthConfigError extends Error {}

function getConfig(): AuthConfig {
  const username = process.env.ADMIN_USERNAME
  const passwordHash = process.env.ADMIN_PASSWORD_HASH
  const secret = process.env.SESSION_SECRET
  if (!username || !passwordHash || !secret) {
    throw new AuthConfigError(
      '未配置管理员账号：需要 ADMIN_USERNAME、ADMIN_PASSWORD_HASH 和 SESSION_SECRET'
    )
  }
  if (secret.length < 32) {
    throw new AuthConfigError('SESSION_SECRET 至少 32 个字符')
  }
  return { username, passwordHash, secret }
}

// ---------------------------------------------------------------------------
// 密码：scrypt:N:r:p:salt:hash（salt / hash 为 base64）。
// 不用 $ 分隔：Next.js 和 docker compose 读 env 文件时都会把 $xxx 当变量展开
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const N = 16384
  const r = 8
  const p = 1
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32, { N, r, p })
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join(':')
}

function verifyPassword(password: string, encoded: string): boolean {
  const [scheme, n, r, p, salt, hash] = encoded.split(':')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  })
  return timingSafeEqual(actual, expected)
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** 校验账号密码；用户名不对时也跑一次 scrypt，避免靠耗时区分用户名是否存在 */
export function checkCredentials(username: string, password: string): boolean {
  const config = getConfig()
  const passwordOk = verifyPassword(password, config.passwordHash)
  return safeEqual(username, config.username) && passwordOk
}

/** 已登录后的二次确认（如注册 Passkey）只校验密码 */
export function checkPassword(password: string): boolean {
  return verifyPassword(password, getConfig().passwordHash)
}

export function adminUsername(): string {
  return getConfig().username
}

// ---------------------------------------------------------------------------
// 签名令牌：base64url(JSON).hmac，用 SESSION_SECRET 签名。
// 会话 cookie 和 Passkey 的 flow token 都用它，靠 kind 区分，不能互相冒用
// ---------------------------------------------------------------------------

function sign(data: string, secret: string) {
  return createHmac('sha256', secret).update(data).digest('base64url')
}

export function signToken<T extends { exp: number }>(kind: string, payload: T): string {
  const { secret } = getConfig()
  const data = Buffer.from(JSON.stringify({ ...payload, kind })).toString('base64url')
  return `${data}.${sign(data, secret)}`
}

/** 签名不对、kind 不符或已过期都返回 null */
export function verifyToken<T extends { exp: number }>(kind: string, token: string): T | null {
  let config: AuthConfig
  try {
    config = getConfig()
  } catch {
    return null
  }
  const [data, mac] = token.split('.')
  if (!data || !mac || !safeEqual(mac, sign(data, config.secret))) return null
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as T & { kind?: string }
    if (payload.kind !== kind) return null
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 会话 cookie
// ---------------------------------------------------------------------------

export type LoginMethod = 'password' | 'passkey'

export interface SessionPayload {
  sid: string
  iat: number
  exp: number
  method?: LoginMethod
}

export function createSession(method: LoginMethod = 'password'): {
  token: string
  payload: SessionPayload
} {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sid: randomUUID(), iat: now, exp: now + SESSION_TTL_SECONDS, method }
  return { token: signToken('session', payload), payload }
}

export function readSession(req: NextRequest): SessionPayload | null {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  return token ? verifyToken<SessionPayload>('session', token) : null
}

export function sessionCookies(token: string): string[] {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return [
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`,
    `${SESSION_HINT_COOKIE}=1; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`,
  ]
}

export function clearSessionCookies(): string[] {
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `${SESSION_HINT_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`,
  ]
}

/**
 * 前端（NewAPI）期望的登录结果：access token + 用户 + 会话。
 * access token 只是前端用来判断登录态的占位，服务端认的是会话 cookie。
 */
export function authBundle(session: SessionPayload) {
  const { username } = getConfig()
  const now = Math.floor(Date.now() / 1000)
  return {
    access_token: randomBytes(24).toString('base64url'),
    token_type: 'Bearer',
    access_expires_at: Math.min(now + ACCESS_TTL_SECONDS, session.exp),
    user: adminUser(username),
    session: {
      sid: session.sid,
      current: true,
      login_method: session.method ?? 'password',
      ip: '',
      user_agent: '',
      created_at: session.iat,
      last_active_at: now,
      expires_at: session.exp,
    },
  }
}

/**
 * 前端（NewAPI）的“当前用户”。概览页的余额、已用量、请求数读的是它，
 * 管理员本身没有额度，这里换成所有应用的汇总：quota 是各应用剩余额度之和，
 * 有启用中的应用不限额度时为 -1（前端显示“不限”）
 */
export function adminUser(username = getConfig().username) {
  return {
    id: ADMIN_USER_ID,
    username,
    display_name: username,
    role: 100, // NewAPI 前端的超级管理员
    status: 1,
    group: 'default',
    ...usageSummary(),
  }
}

function usageSummary() {
  const apps = db()
    .prepare('SELECT quota, used FROM apps WHERE status = 1')
    .all() as { quota: number; used: number }[]
  const unlimited = apps.some((a) => a.quota === 0)
  const remaining = apps.reduce((sum, a) => sum + Math.max(a.quota - a.used, 0), 0)
  const totals = db()
    .prepare(
      `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS used,
              COALESCE(SUM(CASE WHEN error = '' THEN 1 ELSE 0 END), 0) AS requests
       FROM usage_logs`
    )
    .get() as { used: number; requests: number }
  return { quota: unlimited ? -1 : remaining, used_quota: totals.used, request_count: totals.requests }
}

// ---------------------------------------------------------------------------
// 登录限速：每个 IP 15 分钟内最多失败 5 次（单进程，存内存）
// ---------------------------------------------------------------------------

const FAIL_WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 5
const failures = new Map<string, { count: number; resetAt: number }>()

export function clientIp(req: NextRequest): string {
  // Caddy 反代时带 X-Forwarded-For；本机直连时没有
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
}

export function isLockedOut(ip: string): boolean {
  const entry = failures.get(ip)
  if (!entry) return false
  if (entry.resetAt <= Date.now()) {
    failures.delete(ip)
    return false
  }
  return entry.count >= MAX_FAILURES
}

export function recordFailure(ip: string) {
  const now = Date.now()
  const entry = failures.get(ip)
  if (!entry || entry.resetAt <= now) {
    failures.set(ip, { count: 1, resetAt: now + FAIL_WINDOW_MS })
  } else {
    entry.count += 1
  }
}

export function clearFailures(ip: string) {
  failures.delete(ip)
}
