import type { NextRequest } from 'next/server'

import { adminUser, readSession } from '@/server/auth'
import { respond } from '@/server/respond'

export async function GET(req: NextRequest) {
  if (!readSession(req)) {
    return respond({ success: false, message: '未登录' }, { status: 401 })
  }
  return respond({ success: true, data: adminUser() })
}
