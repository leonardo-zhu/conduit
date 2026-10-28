'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { z } from 'zod'

import { sanitizeAuthRedirect } from '@/features/auth/lib/auth-redirect'
import { SignIn } from '@/features/auth/sign-in'
import { registerRoute, useSearch } from '@/lib/router'
import { useAuthStore } from '@/stores/auth-store'

registerRoute('/(auth)/sign-in', { validateSearch: z.object({ redirect: z.string().optional() }) })

export default function SignInPage() {
  const router = useRouter()
  const user = useAuthStore((s) => s.auth.user)
  const { redirect } = useSearch<{ redirect?: string }>({ from: '/(auth)/sign-in' })

  // 已登录时直接跳走（会话已在 AppShell 里确认过）
  useEffect(() => {
    if (user) {
      router.replace(sanitizeAuthRedirect(redirect, window.location.origin) ?? '/dashboard')
    }
  }, [user, redirect, router])

  return user ? null : <SignIn />
}
