import { NextResponse, type NextRequest } from 'next/server'

import '@/mock/handlers'
import { isMockResult, match } from '@/mock/router'
import { readSession } from '@/server/auth'

// 不登录也能访问的接口：登录页要用的站点状态和公告
const PUBLIC_PATHS = new Set(['/api/status', '/api/notice'])

// 假数据接口的统一入口，见 src/mock/。真实接口写成具体路由后会优先于这里匹配
async function handle(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/\/+$/, '')
  if (!PUBLIC_PATHS.has(path) && !readSession(req)) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  }
  const found = match(req.method, path)

  if (!found) {
    console.warn(`[mock] 未实现 ${req.method} ${path}${req.nextUrl.search}`)
    return NextResponse.json(
      { success: false, message: `mock: 未实现 ${req.method} ${path}` },
      { status: 404 }
    )
  }

  let body: unknown = undefined
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await req.json().catch(() => undefined)
  }

  const cookies = new Map(req.cookies.getAll().map((c) => [c.name, c.value]))
  const result = await found.handler({
    method: req.method,
    path,
    params: found.params,
    query: req.nextUrl.searchParams,
    body,
    cookies,
  })

  const { status = 200, body: payload, setCookies = [] } = isMockResult(result)
    ? result
    : { body: result }
  const res = NextResponse.json(payload, { status })
  for (const cookie of setCookies) res.headers.append('Set-Cookie', cookie)
  return res
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
