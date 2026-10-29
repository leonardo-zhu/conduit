import type { NextRequest } from 'next/server'

import { beginLogin } from '@/server/passkey'
import { passkeyRoute } from '@/server/passkey-route'
import { respond } from '@/server/respond'

export async function POST(req: NextRequest) {
  return passkeyRoute(async () => {
    const body = (await req.json().catch(() => ({}))) as { rp_id?: unknown }
    const rpID = typeof body.rp_id === 'string' ? body.rp_id : undefined
    return respond({ success: true, data: await beginLogin(req, rpID) })
  })
}
