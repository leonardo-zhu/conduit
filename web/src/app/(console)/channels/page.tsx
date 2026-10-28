'use client'

import z from 'zod'

import { Channels } from '@/features/channels'
import { registerRoute } from '@/lib/router'

import { RequireAdmin } from '../require-admin'

registerRoute('/_authenticated/channels/', {
  validateSearch: z.object({
    page: z.number().optional().catch(1),
    pageSize: z.number().optional().catch(undefined),
    filter: z.string().optional().catch(''),
    status: z.array(z.string()).optional().catch([]),
    type: z.array(z.string()).optional().catch([]),
    group: z.array(z.string()).optional().catch([]),
    model: z.string().optional().catch(''),
  }),
})

export default function ChannelsPage() {
  return (
    <RequireAdmin>
      <Channels />
    </RequireAdmin>
  )
}
