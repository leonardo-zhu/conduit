/**
 * Conduit: 新建 / 编辑令牌的弹窗，在应用抽屉的“API 密钥”里打开。
 * 只有名称、过期时间和 IP 白名单；额度和可用模型都跟着应用走。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DateTimePicker } from '@/components/datetime-picker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import dayjs from '@/lib/dayjs'
import { handleServerError } from '@/lib/handle-server-error'

import { createApiKey, updateApiKey } from '../api'
import { DEFAULT_EXPIRY_DAYS } from '../constants'
import type { ApiKey } from '../types'
import type { RevealedKey } from './token-key-dialog'

const EXPIRY_PRESETS = [
  { label: 'Never', days: 0 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
] as const

function daysFromNow(days: number) {
  return dayjs().add(days, 'day').toDate()
}

export function KeyFormDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  appId: number
  appSlug: string
  /** 编辑时传入；不传就是新建 */
  apiKey?: ApiKey
  onSaved: (revealed?: RevealedKey) => void
}) {
  const { t } = useTranslation()
  const { open, apiKey } = props
  const [name, setName] = useState('')
  const [expiresAt, setExpiresAt] = useState<Date | null>(null)
  const [allowIps, setAllowIps] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setError('')
    if (apiKey) {
      setName(apiKey.name)
      setExpiresAt(apiKey.expired_time > 0 ? new Date(apiKey.expired_time * 1000) : null)
      setAllowIps(apiKey.allow_ips ?? '')
    } else {
      setName(props.appSlug ? `${props.appSlug}-` : '')
      setExpiresAt(daysFromNow(DEFAULT_EXPIRY_DAYS))
      setAllowIps('')
    }
  }, [open, apiKey, props.appSlug])

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('Enter a name'))
      return
    }
    const data = {
      name: name.trim(),
      expired_time: expiresAt ? Math.floor(expiresAt.getTime() / 1000) : -1,
      allow_ips: allowIps.trim(),
    }
    setIsSaving(true)
    try {
      if (apiKey) {
        const result = await updateApiKey({ ...data, id: apiKey.id })
        if (!result.success) {
          handleServerError(result, t('Failed to update API key'))
          return
        }
        props.onSaved()
      } else {
        const result = await createApiKey({ ...data, user_id: props.appId })
        if (!result.success || !result.data?.key) {
          handleServerError(result, t('Failed to create API key'))
          return
        }
        props.onSaved({ name: result.data.name, key: result.data.key })
      }
      props.onOpenChange(false)
    } catch (e) {
      handleServerError(e, apiKey ? t('Failed to update API key') : t('Failed to create API key'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{apiKey ? t('Edit API key') : t('Create API Key')}</DialogTitle>
          <DialogDescription>
            {t('A key can call every alias of this app and shares its quota')}
          </DialogDescription>
        </DialogHeader>
        <form
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            // 弹窗通过 portal 渲染在应用抽屉的表单里，React 事件会冒泡到外层表单
            e.preventDefault()
            e.stopPropagation()
            void handleSave()
          }}
        >
          <div className='flex flex-col gap-2'>
            <Label htmlFor='key-name'>{t('Name')}</Label>
            <Input
              id='key-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${props.appSlug || 'app'}-server`}
              autoComplete='off'
              aria-invalid={!!error}
            />
            {error ? (
              <p className='text-destructive text-xs'>{error}</p>
            ) : (
              <p className='text-muted-foreground text-xs'>
                {t('One key per device or deployment, so you can revoke one without touching the others')}
              </p>
            )}
          </div>
          <div className='flex flex-col gap-2'>
            <Label>{t('Expiration Time')}</Label>
            <DateTimePicker
              value={expiresAt ?? undefined}
              onChange={(date) => setExpiresAt(date ?? null)}
              placeholder={t('Never expires')}
              className='min-w-0'
            />
            <div className='flex flex-wrap gap-2'>
              {EXPIRY_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => setExpiresAt(preset.days ? daysFromNow(preset.days) : null)}
                >
                  {t(preset.label)}
                </Button>
              ))}
            </div>
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='key-ips'>{t('IP Whitelist (supports CIDR)')}</Label>
            <Textarea
              id='key-ips'
              value={allowIps}
              onChange={(e) => setAllowIps(e.target.value)}
              className='min-h-16 resize-none'
              placeholder={t('One IP per line (empty for no restriction)')}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => props.onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            <Button type='submit' disabled={isSaving}>
              {isSaving ? t('Saving...') : apiKey ? t('Save changes') : t('Create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
