/**
 * /api/* 的路由表：真实接口和假接口共用（假接口见 src/mock/）。
 *
 * NewAPI 前端的请求路径常带或不带结尾斜杠（/api/token/、/api/token/1/），
 * 写成 Next.js 的路由文件不好统一处理，所以由 src/app/api/[...path] 统一分发：
 * 先查真实接口，再查假接口。
 */

export interface ApiRequest {
  method: string
  path: string
  params: Record<string, string>
  query: URLSearchParams
  body: unknown
  cookies: Map<string, string>
}

export interface ApiResult {
  status?: number
  body: unknown
  setCookies?: string[]
}

type Handler = (req: ApiRequest) => ApiResult | unknown | Promise<ApiResult | unknown>

interface Route {
  method: string
  pattern: RegExp
  keys: string[]
  handler: Handler
}

export function createRouter() {
  // 按"方法 + 路径"存：dev 热更新会重新执行 handler 文件，同一路由要覆盖而不是追加
  const routes = new Map<string, Route>()

  /** 注册一条路由，path 里的 :name 是路径参数，结尾斜杠可有可无 */
  function register(method: string, path: string, handler: Handler) {
    const keys: string[] = []
    const source = path.replace(/\/$/, '').replace(/:([A-Za-z_]+)/g, (_, key: string) => {
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

  // 不带参数的路由优先，免得 /api/user/models 被 /api/user/:id 抢先匹配
  function match(method: string, path: string) {
    const ordered = [...routes.values()].sort((a, b) => a.keys.length - b.keys.length)
    for (const route of ordered) {
      if (route.method !== method) continue
      const m = route.pattern.exec(path)
      if (!m) continue
      const params: Record<string, string> = {}
      route.keys.forEach((key, i) => (params[key] = decodeURIComponent(m[i + 1])))
      return { handler: route.handler, params }
    }
    return null
  }

  return { register, match }
}

export function isApiResult(value: unknown): value is ApiResult {
  return typeof value === 'object' && value !== null && 'body' in value && !('success' in value)
}

/** NewAPI 的通用返回格式 */
export const ok = (data?: unknown, message = '') => ({ success: true, message, data })
export const fail = (message: string, status = 200): ApiResult => ({
  status,
  body: { success: false, message },
})

export function pageParams(query: URLSearchParams, defaultSize = 10) {
  const page = Math.max(1, Number(query.get('p') ?? 1) || 1)
  const size = Math.max(
    1,
    Math.min(500, Number(query.get('page_size') ?? query.get('size') ?? defaultSize) || defaultSize)
  )
  return { page, size, offset: (page - 1) * size }
}

/** NewAPI 的分页返回格式：{ items, total, page, page_size } */
export function paginate<T>(items: T[], query: URLSearchParams) {
  const { page, size, offset } = pageParams(query)
  return ok({ items: items.slice(offset, offset + size), total: items.length, page, page_size: size })
}
