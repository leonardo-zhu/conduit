import { NextResponse } from 'next/server'

/** NewAPI 前端约定的返回格式：{ success, message, data } */
export function respond(
  body: { success: boolean; message?: string; data?: unknown; code?: string },
  init: { status?: number; cookies?: string[] } = {}
) {
  const res = NextResponse.json(
    { message: '', ...body },
    { status: init.status ?? 200 }
  )
  for (const cookie of init.cookies ?? []) res.headers.append('Set-Cookie', cookie)
  return res
}
