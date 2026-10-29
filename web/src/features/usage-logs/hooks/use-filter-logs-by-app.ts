import { useCallback } from 'react'

import { useNavigate } from '@/lib/router'

/** Conduit: 点日志里的应用名时按这个应用筛选，其他筛选条件保留，回到第一页 */
export function useFilterLogsByApp() {
  const navigate = useNavigate()
  return useCallback(
    (app: string) =>
      navigate({ search: (prev) => ({ ...prev, username: app, page: 1 }) }),
    [navigate]
  )
}
