'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

// 对应 NewAPI 里带 $section 的路由：section 不合法时跳到默认 section
export function useSectionGuard(base: string, section: string, valid: readonly string[], fallback: string) {
  const router = useRouter()
  const ok = valid.includes(section)
  useEffect(() => {
    if (!ok) router.replace(`${base}/${fallback}`)
  }, [ok, base, fallback, router])
  return ok
}

export function SectionRedirect({ to }: { to: string }) {
  const router = useRouter()
  useEffect(() => {
    router.replace(to)
  }, [to, router])
  return null
}
