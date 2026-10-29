import type { NextRequest } from 'next/server'

import { readSession } from '@/server/auth'
import { deletePasskey } from '@/server/db'
import { respond } from '@/server/respond'

// 删除不要求再输密码：被盗的会话删掉 Passkey 最多让人改用密码登录，不会扩大权限
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!readSession(req)) {
    return respond({ success: false, message: '未登录' }, { status: 401 })
  }
  const { id } = await ctx.params
  if (!deletePasskey(id)) {
    return respond({ success: false, message: 'Passkey 不存在', code: 'PASSKEY_NOT_FOUND' }, { status: 404 })
  }
  return respond({ success: true, data: { id } })
}
