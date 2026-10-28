import type { NextRequest } from 'next/server'

import { authBundle, clearSessionCookies, readSession } from '@/server/auth'
import { respond } from '@/server/respond'

// 前端打开页面时用会话 cookie 换取登录态；cookie 无效返回 401，前端会跳去登录页
export async function POST(req: NextRequest) {
  const session = readSession(req)
  if (!session) {
    return respond(
      { success: false, message: '未登录' },
      { status: 401, cookies: clearSessionCookies() }
    )
  }
  return respond({ success: true, data: authBundle(session) })
}
