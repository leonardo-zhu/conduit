/**
 * Conduit: 应用抽屉里的“API 密钥”区块。一个应用可以有多个密钥（每台设备或每个部署一个），
 * 它们共用应用的别名和额度。这里的操作立即生效，不跟抽屉的“保存”走。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Edit,
  KeyRound,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTableRowActionMenu } from '@/components/data-table/core/row-action-menu'
import {
  SideDrawerSection,
  SideDrawerSectionHeader,
} from '@/components/drawer-layout'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import dayjs from '@/lib/dayjs'
import { handleServerError } from '@/lib/handle-server-error'

import {
  deleteApiKey,
  getApiKeys,
  regenerateApiKey,
  updateApiKeyStatus,
} from '../api'
import { API_KEY_STATUS, API_KEY_STATUSES } from '../constants'
import type { ApiKey } from '../types'
import { KeyFormDialog } from './key-form-dialog'
import { TokenKeyDialog, type RevealedKey } from './token-key-dialog'

type Pending = { action: 'regenerate' | 'delete'; key: ApiKey } | null

export function AppKeysSection(props: { appId?: number; appSlug: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { appId } = props
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ApiKey | undefined>()
  const [pending, setPending] = useState<Pending>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [revealed, setRevealed] = useState<RevealedKey | null>(null)

  const queryKey = ['app-keys', appId]
  const { data: keys = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => (await getApiKeys({ appId })).data?.items ?? [],
    enabled: !!appId,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey })

  const toggleStatus = async (key: ApiKey) => {
    const enable = key.status === API_KEY_STATUS.DISABLED
    try {
      const result = await updateApiKeyStatus(
        key.id,
        enable ? API_KEY_STATUS.ENABLED : API_KEY_STATUS.DISABLED
      )
      if (!result.success) {
        handleServerError(result, t('Failed to update API key status'))
        return
      }
      toast.success(enable ? t('API Key enabled successfully') : t('API Key disabled successfully'))
      void refresh()
    } catch (error) {
      handleServerError(error, t('Failed to update API key status'))
    }
  }

  const confirmPending = async () => {
    if (!pending) return
    setIsWorking(true)
    try {
      if (pending.action === 'regenerate') {
        const result = await regenerateApiKey(pending.key.id)
        if (!result.success || !result.data?.key) {
          handleServerError(result, t('Failed to regenerate the key'))
          return
        }
        setRevealed({ name: pending.key.name, key: result.data.key })
      } else {
        const result = await deleteApiKey(pending.key.id)
        if (!result.success) {
          handleServerError(result, t('Failed to delete API key'))
          return
        }
        toast.success(t('API Key deleted successfully'))
      }
      setPending(null)
      void refresh()
    } catch (error) {
      handleServerError(error, t('An unexpected error occurred'))
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <SideDrawerSection>
      <div className='flex items-start justify-between gap-3'>
        <SideDrawerSectionHeader
          title={t('API Keys')}
          description={t('Each key can call every alias above and shares the app quota')}
          icon={<KeyRound className='size-4' />}
          iconTone='info'
          className='flex-1'
        />
        {appId && (
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => {
              setEditing(undefined)
              setFormOpen(true)
            }}
          >
            <Plus className='size-4' />
            {t('Create API Key')}
          </Button>
        )}
      </div>

      {!appId ? (
        <p className='text-muted-foreground rounded-md border border-dashed py-4 text-center text-sm'>
          {t('Save the app first, then add keys to it')}
        </p>
      ) : isLoading ? (
        <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
      ) : keys.length === 0 ? (
        <p className='text-muted-foreground rounded-md border border-dashed py-4 text-center text-sm'>
          {t('No keys yet. Create one to call this app\'s aliases.')}
        </p>
      ) : (
        <ul className='divide-y rounded-md border'>
          {keys.map((key) => {
            const status = API_KEY_STATUSES[key.status]
            const isDisabled = key.status === API_KEY_STATUS.DISABLED
            return (
              <li key={key.id} className='flex items-center gap-3 px-3 py-2.5'>
                <div className='min-w-0 flex-1'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <span className='truncate text-sm font-medium'>{key.name}</span>
                    {status && key.status !== API_KEY_STATUS.ENABLED && (
                      <StatusBadge
                        label={t(status.label)}
                        variant={status.variant}
                        copyable={false}
                      />
                    )}
                  </div>
                  <div className='text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 text-xs'>
                    <span className='font-mono'>sk-{key.key}</span>
                    <span>
                      {key.expired_time > 0
                        ? t('Expires {{date}}', {
                            date: dayjs.unix(key.expired_time).format('YYYY-MM-DD'),
                          })
                        : t('Never expires')}
                    </span>
                    <span>
                      {key.accessed_time > 0
                        ? t('Last used {{time}}', {
                            time: dayjs.unix(key.accessed_time).fromNow(),
                          })
                        : t('Never used')}
                    </span>
                  </div>
                </div>
                <DataTableRowActionMenu
                  ariaLabel={t('Open menu')}
                  contentClassName='w-[180px]'
                  modal={false}
                >
                  <DropdownMenuItem
                    onClick={() => {
                      setEditing(key)
                      setFormOpen(true)
                    }}
                  >
                    {t('Edit')}
                    <DropdownMenuShortcut>
                      <Edit size={16} />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void toggleStatus(key)}>
                    {isDisabled ? t('Enable') : t('Disable')}
                    <DropdownMenuShortcut>
                      {isDisabled ? <Power size={16} /> : <PowerOff size={16} />}
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  {/* 服务端不存明文，不能复制已有密钥，只能重新生成 */}
                  <DropdownMenuItem onClick={() => setPending({ action: 'regenerate', key })}>
                    {t('Regenerate key')}
                    <DropdownMenuShortcut>
                      <RefreshCw size={16} />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setPending({ action: 'delete', key })}
                    className='text-destructive focus:text-destructive'
                  >
                    {t('Delete')}
                    <DropdownMenuShortcut>
                      <Trash2 size={16} />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DataTableRowActionMenu>
              </li>
            )
          })}
        </ul>
      )}

      {appId && (
        <KeyFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          appId={appId}
          appSlug={props.appSlug}
          apiKey={editing}
          onSaved={(created) => {
            if (created) setRevealed(created)
            else toast.success(t('API Key updated successfully'))
            void refresh()
          }}
        />
      )}
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(value) => !value && setPending(null)}
        title={pending?.action === 'delete' ? t('Delete API key') : t('Regenerate key')}
        desc={
          pending?.action === 'delete'
            ? t('Apps or devices using "{{name}}" can no longer call the gateway. This cannot be undone.', {
                name: pending?.key.name,
              })
            : t(
                'The current key of "{{name}}" stops working immediately. Devices using it must be updated with the new key.',
                { name: pending?.key.name }
              )
        }
        confirmText={pending?.action === 'delete' ? t('Delete') : t('Regenerate')}
        destructive
        isLoading={isWorking}
        handleConfirm={() => void confirmPending()}
        className='sm:max-w-md'
      />
      <TokenKeyDialog revealed={revealed} onClose={() => setRevealed(null)} />
    </SideDrawerSection>
  )
}
