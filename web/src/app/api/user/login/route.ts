import type { NextRequest } from 'next/server'

import {
  AuthConfigError,
  authBundle,
  checkCredentials,
  clearFailures,
  clientIp,
  createSession,
  isLockedOut,
  recordFailure,
  sessionCookies,
} from '@/server/auth'
import { respond } from '@/server/respond'

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  if (isLockedOut(ip)) {
    return respond({ success: false, message: '登录失败次数过多，请 15 分钟后再试' }, { status: 429 })
  }

  const body = (await req.json().catch(() => ({}))) as { username?: unknown; password?: unknown }
  const username = typeof body.username === 'string' ? body.username : ''
  const password = typeof body.password === 'string' ? body.password : ''

  try {
    if (!checkCredentials(username, password)) {
      recordFailure(ip)
      return respond({ success: false, message: '用户名或密码错误' })
    }
  } catch (error) {
    if (error instanceof AuthConfigError) {
      console.error(`[auth] ${error.message}`)
      return respond({ success: false, message: '服务端未配置管理员账号' }, { status: 500 })
    }
    throw error
  }

  clearFailures(ip)
  const { token, payload } = createSession()
  return respond({ success: true, data: authBundle(payload) }, { cookies: sessionCookies(token) })
}
