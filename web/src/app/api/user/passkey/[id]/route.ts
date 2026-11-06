import type { NextRequest } from 'next/server'

import { clientIp, readSession } from '@/server/auth'
import { recordChange, runAsActor } from '@/server/changes'
import { deletePasskey, getPasskey } from '@/server/db'
import { respond } from '@/server/respond'

// 删除不要求再输密码：被盗的会话删掉 Passkey 最多让人改用密码登录，不会扩大权限
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = readSession(req)
  if (!session) {
    return respond({ success: false, message: '未登录' }, { status: 401 })
  }
  const { id } = await ctx.params
  const passkey = getPasskey(id)
  if (!passkey || !deletePasskey(id)) {
    return respond({ success: false, message: 'Passkey 不存在', code: 'PASSKEY_NOT_FOUND' }, { status: 404 })
  }
  runAsActor({ method: session.method ?? 'password', ip: clientIp(req) }, () =>
    recordChange({ subjectType: 'passkey', subjectId: id, subjectName: passkey.name, action: 'delete' })
  )
  return respond({ success: true, data: { id } })
}
