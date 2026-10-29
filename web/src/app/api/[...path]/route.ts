import { NextResponse, type NextRequest } from 'next/server'

import '@/mock/handlers'
import { match as matchMock } from '@/mock/router'
import { match as matchReal } from '@/server/api'
import { readSession } from '@/server/auth'
import { MasterKeyError } from '@/server/crypto'
import { isApiResult } from '@/server/router'

// /api/* 的统一入口：先查 src/server/api/ 的真实接口，再查 src/mock/ 的假接口。
// 写成具体路由文件的接口（登录、Passkey、status）优先于这里匹配
async function handle(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/\/+$/, '')
  if (!readSession(req)) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  }
  const found = matchReal(req.method, path) ?? matchMock(req.method, path)

  if (!found) {
    console.warn(`[api] 未实现 ${req.method} ${path}${req.nextUrl.search}`)
    return NextResponse.json(
      { success: false, message: `未实现 ${req.method} ${path}` },
      { status: 404 }
    )
  }

  let body: unknown = undefined
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await req.json().catch(() => undefined)
  }

  const cookies = new Map(req.cookies.getAll().map((c) => [c.name, c.value]))
  let result: unknown
  try {
    result = await found.handler({
      method: req.method,
      path,
      params: found.params,
      query: req.nextUrl.searchParams,
      body,
      cookies,
    })
  } catch (error) {
    if (error instanceof MasterKeyError) {
      console.error(`[api] ${error.message}`)
      return NextResponse.json({ success: false, message: `服务端配置错误：${error.message}` }, { status: 500 })
    }
    throw error
  }

  const { status = 200, body: payload, setCookies = [] } = isApiResult(result)
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
