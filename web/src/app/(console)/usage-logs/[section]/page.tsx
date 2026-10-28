'use client'

import { use } from 'react'
import z from 'zod'

import { UsageLogs } from '@/features/usage-logs'
import {
  USAGE_LOGS_DEFAULT_SECTION,
  USAGE_LOGS_SECTION_IDS,
} from '@/features/usage-logs/section-registry'
import { registerRoute } from '@/lib/router'

import { useSectionGuard } from '../../section-redirect'

const logTypeValues = ['0', '1', '2', '3', '4', '5', '6', '7'] as const
const logTypeSearchSchema = z
  .preprocess((value) => {
    if (value == null || value === '') return undefined
    return Array.isArray(value) ? value : [value]
  }, z.array(z.enum(logTypeValues)).optional())
  .catch([])

registerRoute('/_authenticated/usage-logs/$section', {
  validateSearch: z.object({
    page: z.number().optional().catch(1),
    pageSize: z.number().optional().catch(undefined),
    type: logTypeSearchSchema.optional(),
    filter: z.string().optional().catch(''),
    model: z.string().optional().catch(''),
    token: z.string().optional().catch(''),
    channel: z.string().optional().catch(''),
    group: z.string().optional().catch(''),
    username: z.string().optional().catch(''),
    requestId: z.string().optional().catch(''),
    upstreamRequestId: z.string().optional().catch(''),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
  }),
})

export default function UsageLogsPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = use(params)
  const ok = useSectionGuard('/usage-logs', section, USAGE_LOGS_SECTION_IDS, USAGE_LOGS_DEFAULT_SECTION)
  return ok ? <UsageLogs /> : null
}
