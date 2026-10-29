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
import { useQueryClient } from '@tanstack/react-query'
import { Plus, TestTube } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_RESOURCES,
  hasPermission,
} from '@/lib/admin-permissions'
import { useAuthStore } from '@/stores/auth-store'

import { handleTestAllChannels } from '../lib'
import { useChannels } from './channels-provider'

export function ChannelsPrimaryButtons() {
  const { t } = useTranslation()
  // Conduit: 去掉了标签模式、优先级排序、余额更新、上游模型更新检测、一致性修复、
  // 批量操作和“删除所有已禁用”；服务商不多，逐个操作就够
  const { setOpen, setCurrentRow } = useChannels()
  const queryClient = useQueryClient()
  const [isTesting, setIsTesting] = useState(false)
  const currentUser = useAuthStore((s) => s.auth.user)
  const canEditSensitive = hasPermission(
    currentUser,
    ADMIN_PERMISSION_RESOURCES.CHANNEL,
    ADMIN_PERMISSION_ACTIONS.SENSITIVE_WRITE
  )

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Button
        variant='outline'
        disabled={isTesting}
        onClick={async () => {
          setIsTesting(true)
          await handleTestAllChannels(queryClient)
          setIsTesting(false)
        }}
      >
        <TestTube className='h-4 w-4' />
        <span className='max-sm:hidden'>
          {isTesting ? t('Testing...') : t('Test All Channels')}
        </span>
      </Button>

      <Tooltip>
        <TooltipTrigger render={<span className='inline-flex' />}>
          <Button
            onClick={() => {
              if (!canEditSensitive) return
              setCurrentRow(null)
              setOpen('create-channel')
            }}
            disabled={!canEditSensitive}
          >
            <Plus className='h-4 w-4' />
            <span className='max-sm:hidden'>{t('Create Channel')}</span>
            <span className='sm:hidden'>{t('Create')}</span>
          </Button>
        </TooltipTrigger>
        {!canEditSensitive && (
          <TooltipContent>
            {t('No permission to perform this action')}
          </TooltipContent>
        )}
      </Tooltip>
    </div>
  )
}
