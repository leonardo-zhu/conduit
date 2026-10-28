'use client'

import { MaintenanceError } from '@/features/errors/maintenance-error'

export default function Error503Page() {
  return <MaintenanceError />
}
