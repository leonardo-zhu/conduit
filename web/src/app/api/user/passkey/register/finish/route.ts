import type { NextRequest } from 'next/server'

import { readSession } from '@/server/auth'
import { getPasskey } from '@/server/db'
import { finishRegistration, publicPasskey } from '@/server/passkey'
import { passkeyRoute } from '@/server/passkey-route'
import { respond } from '@/server/respond'

const MAX_NAME_LENGTH = 50

export async function POST(req: NextRequest) {
  const session = readSession(req)
  if (!session) {
    return respond({ success: false, message: '未登录' }, { status: 401 })
  }
  return passkeyRoute(async () => {
    const body = (await req.json().catch(() => ({}))) as {
      flow_token?: unknown
      credential?: unknown
      name?: unknown
    }
    const name = (typeof body.name === 'string' ? body.name.trim() : '').slice(0, MAX_NAME_LENGTH)
    const id = await finishRegistration(req, session.sid, body.flow_token, body.credential, name || 'Passkey')
    return respond({ success: true, data: publicPasskey(getPasskey(id)!) })
  })
}
