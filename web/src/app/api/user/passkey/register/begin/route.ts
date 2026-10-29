import type { NextRequest } from 'next/server'

import {
  checkPassword,
  clearFailures,
  clientIp,
  isLockedOut,
  readSession,
  recordFailure,
} from '@/server/auth'
import { beginRegistration } from '@/server/passkey'
import { passkeyRoute } from '@/server/passkey-route'
import { respond } from '@/server/respond'

// 注册前再输一次密码，防止被盗的会话悄悄绑上攻击者的 Passkey；失败次数和登录共用限速
export async function POST(req: NextRequest) {
  const session = readSession(req)
  if (!session) {
    return respond({ success: false, message: '未登录' }, { status: 401 })
  }
  const ip = clientIp(req)
  if (isLockedOut(ip)) {
    return respond({ success: false, message: '密码错误次数过多，请 15 分钟后再试' }, { status: 429 })
  }
  return passkeyRoute(async () => {
    const body = (await req.json().catch(() => ({}))) as { password?: unknown }
    const password = typeof body.password === 'string' ? body.password : ''
    if (!checkPassword(password)) {
      recordFailure(ip)
      return respond({ success: false, message: '密码错误' }, { status: 400 })
    }
    clearFailures(ip)
    return respond({ success: true, data: await beginRegistration(req, session.sid) })
  })
}
