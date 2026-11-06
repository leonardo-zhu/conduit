'use client'

import { ConfigChanges } from '@/features/changes'

import { RequireAdmin } from '../require-admin'

export default function ChangesPage() {
  return (
    <RequireAdmin>
      <ConfigChanges />
    </RequireAdmin>
  )
}
