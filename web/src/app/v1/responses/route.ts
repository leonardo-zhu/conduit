import type { NextRequest } from 'next/server'

import { handleGateway } from '@/server/gateway/handler'

// 网关数据面，见 src/server/gateway/。不走后台的会话登录，用令牌鉴权
export const dynamic = 'force-dynamic'

export function POST(req: NextRequest) {
  return handleGateway(req, 'responses')
}
