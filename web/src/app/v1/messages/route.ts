import type { NextRequest } from 'next/server'

import { handleGateway } from '@/server/gateway/handler'

export const dynamic = 'force-dynamic'

export function POST(req: NextRequest) {
  return handleGateway(req, 'messages')
}
