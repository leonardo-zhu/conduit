'use client'

import { ForbiddenError } from '@/features/errors/forbidden'

export default function Error403Page() {
  return <ForbiddenError />
}
