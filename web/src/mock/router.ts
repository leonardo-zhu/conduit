/**
 * 假数据接口的路由表。
 *
 * 自己的后端写好之前，页面请求的 /api/* 由这里按 NewAPI 的返回格式应答，
 * 用来跑通页面、决定每页留哪些字段。接口逐个换成真实实现后删掉对应条目。
 */

export interface MockRequest {
  method: string
  path: string
  params: Record<string, string>
  query: URLSearchParams
  body: unknown
  cookies: Map<string, string>
}

export interface MockResult {
  status?: number
  body: unknown
  setCookies?: string[]
}

type Handler = (req: MockRequest) => MockResult | unknown

interface Route {
  method: string
  pattern: RegExp
  keys: string[]
  handler: Handler
}

// 按"方法 + 路径"存：dev 热更新会重新执行 handler 文件，同一路由要覆盖而不是追加
const routes = new Map<string, Route>()

/** 注册一条路由，path 里的 :name 是路径参数，结尾斜杠可有可无 */
export function mock(method: string, path: string, handler: Handler) {
  const keys: string[] = []
  const source = path
    .replace(/\/$/, '')
    .replace(/:([A-Za-z_]+)/g, (_, key: string) => {
      keys.push(key)
      return '([^/]+)'
    })
  routes.set(`${method} ${path}`, {
    method,
    pattern: new RegExp(`^${source}/?$`),
    keys,
    handler,
  })
}

export function match(method: string, path: string) {
  for (const route of routes.values()) {
    if (route.method !== method) continue
    const m = route.pattern.exec(path)
    if (!m) continue
    const params: Record<string, string> = {}
    route.keys.forEach((key, i) => (params[key] = decodeURIComponent(m[i + 1])))
    return { handler: route.handler, params }
  }
  return null
}

export function isMockResult(value: unknown): value is MockResult {
  return typeof value === 'object' && value !== null && 'body' in value
}

/** NewAPI 的通用返回格式 */
export const ok = (data?: unknown, message = '') => ({ success: true, message, data })
export const fail = (message: string, status = 200): MockResult => ({
  status,
  body: { success: false, message },
})

/** NewAPI 的分页返回格式：{ items, total, page, page_size } */
export function paginate<T>(items: T[], query: URLSearchParams) {
  const page = Math.max(1, Number(query.get('p') ?? 1) || 1)
  const size = Math.max(1, Number(query.get('page_size') ?? query.get('size') ?? 10) || 10)
  return ok({
    items: items.slice((page - 1) * size, page * size),
    total: items.length,
    page,
    page_size: size,
  })
}
