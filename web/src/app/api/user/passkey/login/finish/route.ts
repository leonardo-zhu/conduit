import type { NextRequest } from 'next/server'

import { authBundle, createSession, sessionCookies } from '@/server/auth'
import { finishLogin } from '@/server/passkey'
import { passkeyRoute } from '@/server/passkey-route'
import { respond } from '@/server/respond'

export async function POST(req: NextRequest) {
  return passkeyRoute(async () => {
    const body = (await req.json().catch(() => ({}))) as { flow_token?: unknown; credential?: unknown }
    await finishLogin(req, body.flow_token, body.credential)
    const { token, payload } = createSession('passkey')
    return respond({ success: true, data: authBundle(payload) }, { cookies: sessionCookies(token) })
  })
}
