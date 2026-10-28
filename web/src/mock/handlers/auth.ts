import { randomUUID } from 'node:crypto'

import { users } from '../data'
import { fail, mock, ok } from '../router'

// 假登录：账号密码来自环境变量，默认值见 web/.env.example。只认管理员一个账号
const ADMIN_USERNAME = process.env.MOCK_ADMIN_USERNAME ?? 'admin'
const ADMIN_PASSWORD = process.env.MOCK_ADMIN_PASSWORD ?? 'conduit-dev'

const SESSION_COOKIE = 'conduit_mock_session'
// 前端用这个 cookie 判断要不要尝试 refresh（NewAPI 的约定）
const HINT_COOKIE = 'new_api_has_session'

const sessions = new Map<string, number>()

function bundle(sid: number | string, userId: number) {
  const t = Math.floor(Date.now() / 1000)
  return {
    access_token: `mock-access-${randomUUID()}`,
    token_type: 'Bearer',
    access_expires_at: t + 3600,
    user: users.find((u) => u.id === userId),
    session: {
      sid: String(sid),
      current: true,
      login_method: 'password',
      ip: '127.0.0.1',
      user_agent: 'mock',
      created_at: t,
      last_active_at: t,
      expires_at: t + 7 * 86400,
    },
  }
}

mock('POST', '/api/user/login', ({ body }) => {
  const { username, password } = (body ?? {}) as { username?: string; password?: string }
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return fail('用户名或密码错误')
  }
  const sid = randomUUID()
  sessions.set(sid, 1)
  return {
    body: ok(bundle(sid, 1)),
    setCookies: [
      `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax`,
      `${HINT_COOKIE}=1; Path=/; SameSite=Lax`,
    ],
  }
})

mock('POST', '/api/user/auth/refresh', ({ cookies }) => {
  const sid = cookies.get(SESSION_COOKIE)
  const userId = sid ? sessions.get(sid) : undefined
  // dev 服务重启后内存里的会话会丢，cookie 还在时直接当作管理员续上，省得反复登录
  if (!sid || (!userId && process.env.NODE_ENV !== 'development')) {
    return fail('未登录', 401)
  }
  sessions.set(sid, userId ?? 1)
  return ok(bundle(sid, userId ?? 1))
})

mock('POST', '/api/user/auth/logout', ({ cookies }) => {
  const sid = cookies.get(SESSION_COOKIE)
  if (sid) sessions.delete(sid)
  return {
    body: ok(),
    setCookies: [
      `${SESSION_COOKIE}=; Path=/; Max-Age=0`,
      `${HINT_COOKIE}=; Path=/; Max-Age=0`,
    ],
  }
})

mock('GET', '/api/user/self', () => ok(users[0]))
