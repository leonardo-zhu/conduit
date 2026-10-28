'use client'

import { use } from 'react'

import { Dashboard } from '@/features/dashboard'
import {
  DASHBOARD_DEFAULT_SECTION,
  DASHBOARD_SECTION_IDS,
} from '@/features/dashboard/section-registry'

import { useSectionGuard } from '../../section-redirect'

export default function DashboardPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = use(params)
  const ok = useSectionGuard('/dashboard', section, DASHBOARD_SECTION_IDS, DASHBOARD_DEFAULT_SECTION)
  return ok ? <Dashboard /> : null
}
