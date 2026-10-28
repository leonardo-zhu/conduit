import { clearSessionCookies } from '@/server/auth'
import { respond } from '@/server/respond'

// 会话不存服务端，登出就是清掉 cookie；要让所有会话失效，换 SESSION_SECRET 后重启
export async function POST() {
  return respond({ success: true }, { cookies: clearSessionCookies() })
}
