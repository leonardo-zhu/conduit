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
import { Plus, MoreHorizontal, Trash2, TestTube, ListChecks } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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

import { handleDeleteAllDisabled, handleTestAllChannels } from '../lib'
import { useChannels } from './channels-provider'

export function ChannelsPrimaryButtons() {
  const { t } = useTranslation()
  // Conduit: 去掉了标签模式、优先级排序、余额更新、上游模型更新检测和一致性修复
  const { setOpen, setCurrentRow, batchMode, setBatchMode } = useChannels()
  const queryClient = useQueryClient()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const currentUser = useAuthStore((s) => s.auth.user)
  const canEditSensitive = hasPermission(
    currentUser,
    ADMIN_PERMISSION_RESOURCES.CHANNEL,
    ADMIN_PERMISSION_ACTIONS.SENSITIVE_WRITE
  )

  const handleBatchModeToggle = (checked: boolean) => {
    setBatchMode(checked)
  }

  return (
    <>
      <div className='flex flex-wrap items-center gap-2'>
        {/* Desktop: Toggle switches visible */}
        <div className='bg-muted/40 hidden h-8 shrink-0 items-center gap-2.5 rounded-lg border px-2.5 sm:flex'>
          <div className='text-muted-foreground has-data-checked:text-foreground flex items-center gap-2'>
            <Label
              htmlFor='channel-batch-mode'
              className='cursor-pointer gap-1.5 text-xs whitespace-nowrap'
            >
              <ListChecks className='size-3.5' aria-hidden />
              {t('Batch Operations')}
            </Label>
            <Switch
              id='channel-batch-mode'
              size='sm'
              checked={batchMode}
              onCheckedChange={handleBatchModeToggle}
            />
          </div>
        </div>

        {/* Create Channel */}
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

        {/* More Actions */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant='outline' size='icon' />}
            aria-label={t('More actions')}
          >
            <MoreHorizontal className='size-4' aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-56'>
            {/* Mobile-only: toggle switches */}
            <DropdownMenuCheckboxItem
              className='sm:hidden'
              checked={batchMode}
              onCheckedChange={handleBatchModeToggle}
            >
              <ListChecks className='mr-2 h-4 w-4' />
              {t('Batch Operations')}
            </DropdownMenuCheckboxItem>

            <DropdownMenuSeparator className='sm:hidden' />

            <DropdownMenuItem
              onClick={() => {
                handleTestAllChannels(queryClient)
              }}
            >
              {t('Test All Channels')}
              <DropdownMenuShortcut>
                <TestTube className='h-4 w-4' />
              </DropdownMenuShortcut>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                if (!canEditSensitive) return
                setShowDeleteDialog(true)
              }}
              disabled={!canEditSensitive}
              className='text-destructive focus:text-destructive'
            >
              {t('Delete All Disabled')}
              <DropdownMenuShortcut>
                <Trash2 className='h-4 w-4' />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title={t('Delete All Disabled Channels?')}
        desc={t(
          'This will permanently delete all manually and automatically disabled channels. This action cannot be undone.'
        )}
        destructive
        handleConfirm={() => {
          if (!canEditSensitive) return
          handleDeleteAllDisabled(queryClient, (_count) => {
            // eslint-disable-next-line no-console
            console.log(`Deleted ${_count} channels`)
          })
          setShowDeleteDialog(false)
        }}
      />

    </>
  )
}
