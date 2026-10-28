import { useQuery } from '@tanstack/react-query'

import { getUsers } from '@/features/users/api'
import { ROLE } from '@/lib/roles'
import { requireServerSuccess } from '@/lib/server-error-message'

export interface AppOption {
  id: number
  name: string
  displayName: string
}

/**
 * Conduit 的应用列表。
 *
 * 后端还沿用 NewAPI 的接口时，应用就是普通用户（管理员账号不算应用），
 * 换成自己的 /api/app 后只改这里。
 */
export function useApps(enabled = true) {
  return useQuery({
    queryKey: ['apps'],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const res = requireServerSuccess(await getUsers({ p: 1, page_size: 100 }))
      return (res.data?.items ?? [])
        .filter((u) => u.role < ROLE.ADMIN)
        .map<AppOption>((u) => ({
          id: u.id,
          name: u.username,
          displayName: u.display_name || u.username,
        }))
    },
  })
}
