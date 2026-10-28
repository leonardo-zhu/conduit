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

  // 未登录（含刚退出）交给登录跳转处理，只有已登录但不是管理员才去 403
  useEffect(() => {
    if (role !== undefined && !isAdmin) router.replace('/403')
  }, [role, isAdmin, router])

  return isAdmin ? <>{children}</> : null
}
