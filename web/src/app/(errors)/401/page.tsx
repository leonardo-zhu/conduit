'use client'

import { UnauthorisedError } from '@/features/errors/unauthorized-error'

export default function Error401Page() {
  return <UnauthorisedError />
}
