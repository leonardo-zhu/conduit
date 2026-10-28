'use client'

import z from 'zod'

import { Users } from '@/features/users'
import { registerRoute } from '@/lib/router'

import { RequireAdmin } from '../require-admin'

registerRoute('/_authenticated/users/', {
  validateSearch: z.object({
    page: z.number().optional().catch(1),
    pageSize: z.number().optional().catch(undefined),
    filter: z.string().optional().catch(''),
    status: z
      .array(z.enum(['-1', '1', '2']))
      .optional()
      .catch([]),
    role: z
      .array(z.enum(['1', '10', '100']))
      .optional()
      .catch([]),
    group: z.array(z.string()).optional().catch([]),
  }),
})

export default function UsersPage() {
  return (
    <RequireAdmin>
      <Users />
    </RequireAdmin>
  )
}
