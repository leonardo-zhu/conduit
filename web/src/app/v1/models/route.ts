import type { NextRequest } from 'next/server'

import { handleModels } from '@/server/gateway/handler'

export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  return handleModels(req)
}
