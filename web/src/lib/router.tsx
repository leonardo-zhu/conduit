'use client'

/**
 * Conduit: TanStack Router → Next.js App Router 兼容层。
 *
 * 前端代码大部分照搬自 NewAPI（TanStack Router）。为了尽量不改原文件，这里按
 * 原代码实际用到的那部分 API（Link / useNavigate / getRouteApi / useLocation /
 * useRouterState / useRouter / Outlet）用 next/navigation 重新实现，原文件只把
 * import 从 '@tanstack/react-router' 改成 '@/lib/router'。
 *
 * search 参数沿用 TanStack 的默认序列化：非字符串值 JSON 编码，读取时先尝试
 * JSON.parse。各页面的 validateSearch（zod）通过 registerRoute 注册，
 * getRouteApi(id).useSearch() 读取时套用。
 */
import NextLink from 'next/link'
import {
  useParams as useNextParams,
  usePathname,
  useRouter as useNextRouter,
  useSearchParams,
} from 'next/navigation'
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
  type AnchorHTMLAttributes,
  type ReactNode,
} from 'react'

type SearchRecord = Record<string, unknown>
type SearchSchema = { parse: (input: unknown) => unknown }

type SearchInput =
  | SearchRecord
  | true
  | ((prev: SearchRecord) => SearchRecord)
  | undefined

export interface NavigateOptions {
  to?: string
  href?: string
  params?: Record<string, string | number>
  search?: SearchInput
  hash?: string
  replace?: boolean
  resetScroll?: boolean
}

export interface LinkProps {
  to?: string
  params?: Record<string, string | number>
  search?: SearchInput
  hash?: string
  replace?: boolean
}

const searchSchemas = new Map<string, SearchSchema>()

/** 页面文件里注册 search 校验，对应 TanStack 的 createFileRoute({ validateSearch }) */
export function registerRoute(id: string, opts: { validateSearch?: SearchSchema }) {
  if (opts.validateSearch) searchSchemas.set(id, opts.validateSearch)
}

function parseSearch(params: URLSearchParams): SearchRecord {
  const out: SearchRecord = {}
  for (const [key, raw] of params.entries()) {
    try {
      out[key] = JSON.parse(raw)
    } catch {
      out[key] = raw
    }
  }
  return out
}

function stringifySearch(search: SearchRecord): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string') {
      // 字符串本身能被 JSON.parse 解析（如 "123"、"true"）时要再编码一次，读回来才还是字符串
      let ambiguous = false
      try {
        JSON.parse(value)
        ambiguous = true
      } catch {}
      params.set(key, ambiguous ? JSON.stringify(value) : value)
    } else {
      params.set(key, JSON.stringify(value))
    }
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

function interpolatePath(to: string, params?: Record<string, string | number>) {
  let path = to.replace(/\/\$([A-Za-z0-9_]+)/g, (_, name: string) => {
    const value = params?.[name]
    return value === undefined ? '' : `/${encodeURIComponent(String(value))}`
  })
  // TanStack 的路由 id 带结尾斜杠（如 '/keys/'），URL 不需要
  if (path.length > 1) path = path.replace(/\/$/, '')
  return path || '/'
}

function resolveSearch(input: SearchInput, current: SearchRecord): SearchRecord {
  if (input === undefined) return {}
  if (input === true) return current
  if (typeof input === 'function') return input(current)
  return input
}

function useCurrentSearch(): SearchRecord {
  const searchParams = useSearchParams()
  return useMemo(() => parseSearch(new URLSearchParams(searchParams?.toString())), [searchParams])
}

function buildHref(opts: LinkProps, pathname: string, currentSearch: SearchRecord) {
  const path = opts.to ? interpolatePath(opts.to, opts.params) : pathname
  // 没写 to 时是"在当前页改 search"，默认保留现有 search
  const searchInput = opts.search ?? (opts.to ? undefined : true)
  const search = stringifySearch(resolveSearch(searchInput, currentSearch))
  return `${path}${search}${opts.hash ? `#${opts.hash}` : ''}`
}

// TanStack 的 useNavigate({ from }) 只用于类型推导，这里忽略参数
export function useNavigate(_opts?: { from?: string }) {
  const router = useNextRouter()
  const pathname = usePathname()
  const currentSearch = useCurrentSearch()

  return useCallback(
    async (opts: NavigateOptions = {}) => {
      const href = opts.href ?? buildHref(opts, pathname, currentSearch)
      const scroll = opts.resetScroll ?? !!opts.to
      if (opts.replace) router.replace(href, { scroll })
      else router.push(href, { scroll })
    },
    [router, pathname, currentSearch]
  )
}

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>

export const Link = forwardRef<
  HTMLAnchorElement,
  LinkProps &
    AnchorProps & {
      href?: string
      activeProps?: AnchorProps
      preload?: boolean | 'intent' | 'viewport' | 'render'
      disabled?: boolean
    }
>(function Link(
  { to, params, search, hash, replace, href, activeProps, preload, disabled, ...rest },
  ref
) {
  const pathname = usePathname()
  const currentSearch = useCurrentSearch()
  const target = href ?? buildHref({ to, params, search, hash }, pathname, currentSearch)
  const isActive = activeProps && target.split('?')[0] === pathname
  // TanStack 的 disabled Link 不导航，这里渲染成没有 href 的 <a>
  if (disabled) return <a ref={ref} aria-disabled='true' {...rest} />
  return (
    <NextLink
      ref={ref}
      href={target}
      replace={replace}
      prefetch={preload === false ? false : undefined}
      {...rest}
      {...(isActive ? activeProps : undefined)}
    />
  )
})

interface LocationState {
  pathname: string
  search: SearchRecord
  searchStr: string
  href: string
  hash: string
}

export function useLocation(): LocationState
export function useLocation<T>(opts: { select: (l: LocationState) => T }): T
export function useLocation<T>(opts?: { select: (l: LocationState) => T }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = useCurrentSearch()
  const searchStr = searchParams?.toString() ? `?${searchParams.toString()}` : ''
  const location: LocationState = {
    pathname,
    search,
    searchStr,
    href: `${pathname}${searchStr}`,
    hash: '',
  }
  return opts ? opts.select(location) : location
}

interface RouterState {
  status: 'idle' | 'pending'
  location: LocationState
  matches: { routeId: string }[]
}

export function useRouterState(): RouterState
export function useRouterState<T>(opts: { select: (s: RouterState) => T }): T
export function useRouterState<T>(opts?: { select: (s: RouterState) => T }) {
  const location = useLocation()
  // App Router 没有暴露"导航进行中"状态，这里固定 idle；路由 id 用路径代替
  const state: RouterState = {
    status: 'idle',
    location,
    matches: [{ routeId: location.pathname }],
  }
  return opts ? opts.select(state) : state
}

export function useRouter() {
  const router = useNextRouter()
  const navigate = useNavigate()
  return useMemo(
    () => ({
      navigate,
      history: {
        back: () => router.back(),
        forward: () => router.forward(),
        go: (n: number) => window.history.go(n),
      },
      invalidate: () => router.refresh(),
    }),
    [router, navigate]
  )
}

export function getRouteApi(id: string) {
  return {
    // TanStack 按路由注册推导出具体类型；这里拿不到，默认放宽成 any，由调用方自己约束
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useSearch<T = Record<string, any>>(): T {
      const search = useCurrentSearch()
      return useMemo(() => {
        const schema = searchSchemas.get(id)
        return (schema ? schema.parse(search) : search) as T
      }, [search])
    },
    useParams<T = Record<string, string>>(): T {
      return useNextParams() as T
    },
    useNavigate,
  }
}

/** 对应 TanStack 的 useSearch({ from })，按 from 的路由 id 套用注册过的 search 校验 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useSearch<T = Record<string, any>>(opts: { from: string }): T {
  return getRouteApi(opts.from).useSearch<T>()
}

const OutletContext = createContext<ReactNode>(null)

/**
 * Next 用 children 嵌套布局：Next 的 layout 把它收到的 children 作为 outlet 传进来，
 * 原布局组件（如 AuthenticatedLayout）里的 <Outlet /> 照常渲染页面。
 */
export function OutletProvider({ outlet, children }: { outlet: ReactNode; children: ReactNode }) {
  return <OutletContext.Provider value={outlet}>{children}</OutletContext.Provider>
}

export function Outlet() {
  return <>{useContext(OutletContext)}</>
}
