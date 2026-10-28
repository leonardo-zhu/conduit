'use client'

import { useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'

import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

// 对应 NewAPI 各管理页 beforeLoad 里的角色检查
export function RequireAdmin({ children }: { children: ReactNode }) {
  const router = useRouter()
  const role = useAuthStore((s) => s.auth.user?.role)
  const isAdmin = role !== undefined && role >= ROLE.ADMIN

  useEffect(() => {
    if (!isAdmin) router.replace('/403')
  }, [isAdmin, router])

  return isAdmin ? <>{children}</> : null
}
