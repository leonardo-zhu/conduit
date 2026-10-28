import { redirect } from 'next/navigation'

import { USAGE_LOGS_DEFAULT_SECTION } from '@/features/usage-logs/section-registry'

export default function UsageLogsIndex() {
  redirect(`/usage-logs/${USAGE_LOGS_DEFAULT_SECTION}`)
}
