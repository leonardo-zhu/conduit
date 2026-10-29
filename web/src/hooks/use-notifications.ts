/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { getEvents, markAllEventsRead, markEventRead } from '@/lib/api'

// Conduit: 改为读网关事件（/api/events），已读状态存在服务端；原来读 NewAPI 的通知和公告
const EVENTS_KEY = ['events']

export function useNotifications() {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: EVENTS_KEY,
    queryFn: getEvents,
    refetchInterval: 60_000,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: EVENTS_KEY })
  const markRead = useMutation({
    mutationFn: markEventRead,
    onSuccess: invalidate,
  })
  const markAllRead = useMutation({
    mutationFn: markAllEventsRead,
    onSuccess: invalidate,
  })

  return {
    events: data?.items ?? [],
    unreadCount: data?.unread ?? 0,
    loading: isLoading,
    popoverOpen,
    setPopoverOpen,
    markRead: (id: number) => markRead.mutate(id),
    markAllRead: () => markAllRead.mutate(),
  }
}
