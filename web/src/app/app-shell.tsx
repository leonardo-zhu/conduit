'use client'

/**
 * 应用外壳：合并了 NewAPI 的 main.tsx（初始化、Provider）和 routes/__root.tsx（会话校验、跨标签页同步）。
 * 去掉了 setup 引导检查、旧路由跳转和 affiliate 参数，Conduit 用不到。
 */
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { StrictMode, useEffect, useState, type ReactNode } from 'react'

import { NavigationProgress } from '@/components/navigation-progress'
import { Toaster } from '@/components/ui/sonner'
import { DirectionProvider } from '@/context/direction-provider'
import { FontProvider } from '@/context/font-provider'
import { ThemeCustomizationProvider } from '@/context/theme-customization-provider'
import { ThemeProvider } from '@/context/theme-provider'
import { useSystemConfig } from '@/hooks/use-system-config'
import '@/i18n/config'
import {
  bootstrapAuthentication,
  clearAuthenticatedClientState,
  clearAuthentication,
} from '@/lib/auth-session'
import { subscribeAuthSessionEvents } from '@/lib/auth-session-sync'
import { installBuildMetadata } from '@/lib/build-metadata'
import '@/lib/dayjs'
import { applyFaviconToDom } from '@/lib/dom-utils'
import { initializeFrontendCache } from '@/lib/frontend-cache'
import { createAppQueryClient } from '@/lib/query-client'
import { readCachedStatus, statusQueryOptions } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'

initializeFrontendCache()
installBuildMetadata()

// 原来是 router.navigate({ to: '/500' })（客户端跳转）。不能用 location.assign：
// 整页刷新后 /500 页面会重新发起同一个失败的请求，陷入循环
let navigateTo: ((href: string) => void) | null = null
const queryClient = createAppQueryClient(() => {
  if (window.location.pathname !== '/500') navigateTo?.('/500')
})

// 先用缓存的站点名和图标，再从网络刷新（同时预热 ['status'] 查询）
;(function initSystemBranding() {
  try {
    const apply = (name: string) => {
      document.title = name
    }
    const cached = readCachedStatus()
    if (cached?.system_name) apply(cached.system_name as string)
    if (cached?.logo) applyFaviconToDom(cached.logo as string)

    queryClient
      .ensureQueryData(statusQueryOptions)
      .then((s) => {
        if (s?.system_name) apply(s.system_name as string)
        if (s?.logo) applyFaviconToDom(s.logo as string)
      })
      .catch(() => {})
  } catch {}
})()

// 对应 __root 的 beforeLoad：会话确认之前不渲染页面
const authReady = bootstrapAuthentication().catch(() => undefined)

function RootEffects({ children }: { children: ReactNode }) {
  const router = useRouter()
  const client = useQueryClient()

  useSystemConfig({ autoLoad: true })

  useEffect(() => {
    navigateTo = (href) => router.push(href)
    return () => {
      navigateTo = null
    }
  }, [router])

  useEffect(
    () =>
      useAuthStore.subscribe((state, previousState) => {
        if (state.auth.session?.sid !== previousState.auth.session?.sid) {
          client.clear()
        }
      }),
    [client]
  )

  useEffect(
    () =>
      subscribeAuthSessionEvents((event) => {
        const currentSID = useAuthStore.getState().auth.session?.sid

        if (event.kind === 'authenticated') {
          if (event.sid === currentSID) return
          if (currentSID) {
            clearAuthentication(false)
          }
          window.location.reload()
          return
        }

        if (currentSID && event.sid === currentSID) {
          clearAuthenticatedClientState(client, false)
          router.replace('/sign-in')
        }
      }),
    [router, client]
  )

  return (
    <ThemeCustomizationProvider>
      <NavigationProgress />
      {children}
      <Toaster closeButton duration={5000} position='top-center' richColors />
    </ThemeCustomizationProvider>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    void authReady.then(() => alive && setReady(true))
    return () => {
      alive = false
    }
  }, [])

  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <FontProvider>
            <DirectionProvider>
              {ready ? <RootEffects>{children}</RootEffects> : null}
            </DirectionProvider>
          </FontProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>
  )
}
