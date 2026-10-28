'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

import { AuthenticatedLayout } from '@/components/layout'
import { resolveAuthentication } from '@/lib/auth-session'
import { OutletProvider } from '@/lib/router'
import { useAuthStore } from '@/stores/auth-store'

// 对应 NewAPI 的 routes/_authenticated/route.tsx：未登录跳到登录页并带上 redirect
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    let alive = true
    void resolveAuthentication().then(() => {
      if (!alive) return
      const { auth } = useAuthStore.getState()
      if (!auth.user || !auth.accessToken) {
        const redirect = window.location.pathname + window.location.search
        router.replace(`/sign-in?redirect=${encodeURIComponent(redirect)}`)
        return
      }
      setAllowed(true)
    })
    return () => {
      alive = false
    }
  }, [router])

  if (!allowed) return null

  return (
    <OutletProvider outlet={children}>
      <AuthenticatedLayout />
    </OutletProvider>
  )
}
