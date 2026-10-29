import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { PasswordInput } from '@/components/password-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatTimestamp } from '@/lib/format'
import {
  buildRegistrationResult,
  createCredential,
  isPasskeySupported,
  prepareCredentialCreationOptions,
} from '@/lib/passkey'
import { AuthOperationError } from '@/lib/secure-verification'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'

import {
  beginPasskeyRegistration,
  deletePasskey,
  finishPasskeyRegistration,
  listPasskeys,
} from '../api'
import type { PasskeyItem } from '../types'

const PASSKEYS_QUERY_KEY = ['passkeys'] as const

interface PasskeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 管理员的 Passkey 列表：查看、添加（需再输密码）、删除 */
export function PasskeyDialog({ open, onOpenChange }: PasskeyDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [supported, setSupported] = useState(true)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<PasskeyItem | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)

  const { data: passkeys, isLoading } = useQuery({
    queryKey: PASSKEYS_QUERY_KEY,
    queryFn: listPasskeys,
    enabled: open,
  })

  useEffect(() => {
    void isPasskeySupported().then(setSupported)
  }, [])

  useEffect(() => {
    if (!open) setAdding(false)
  }, [open])

  // 登录页按 /api/status 的 passkey_login 决定是否显示 Passkey 按钮，增删后一起刷新
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
    ])

  const handleRemove = async () => {
    if (!removing) return
    setIsRemoving(true)
    try {
      await deletePasskey(removing.id)
      toast.success(t('Passkey removed'))
      setRemoving(null)
      await refresh()
    } catch (error) {
      toast.error(t(AuthOperationError.from(error).message))
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>{t('Passkeys')}</DialogTitle>
            <DialogDescription>
              {t(
                'Sign in with Touch ID, Face ID or a security key instead of the password. You can register several, e.g. one synced via iCloud plus a hardware key.'
              )}
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-2'>
            {isLoading ? (
              <div className='text-muted-foreground flex items-center gap-2 py-6 text-sm'>
                <Loader2 className='size-4 animate-spin' />
                {t('Loading...')}
              </div>
            ) : passkeys?.length ? (
              passkeys.map((passkey) => (
                <PasskeyRow
                  key={passkey.id}
                  passkey={passkey}
                  onRemove={() => setRemoving(passkey)}
                />
              ))
            ) : (
              <p className='text-muted-foreground rounded-md border border-dashed py-6 text-center text-sm'>
                {t('No Passkey registered yet')}
              </p>
            )}
          </div>

          {adding ? (
            <AddPasskeyForm
              onCancel={() => setAdding(false)}
              onAdded={async () => {
                setAdding(false)
                await refresh()
              }}
            />
          ) : (
            <div className='space-y-2'>
              <Button
                variant='outline'
                className='w-full'
                disabled={!supported}
                onClick={() => setAdding(true)}
              >
                <Plus className='size-4' />
                {t('Add Passkey')}
              </Button>
              {!supported && (
                <p className='text-muted-foreground text-center text-xs'>
                  {t('Passkey is not supported on this device.')}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(value) => !value && setRemoving(null)}
        title={t('Remove Passkey')}
        desc={t(
          'Remove "{{name}}"? It will no longer be able to sign in. The credential stays on the device; delete it there too if you no longer need it.',
          { name: removing?.name }
        )}
        confirmText={t('Remove')}
        destructive
        isLoading={isRemoving}
        handleConfirm={handleRemove}
        className='sm:max-w-sm'
      />
    </>
  )
}

function PasskeyRow(props: { passkey: PasskeyItem; onRemove: () => void }) {
  const { t } = useTranslation()
  const { passkey } = props
  return (
    <div className='flex items-center gap-3 rounded-md border px-3 py-2.5'>
      <KeyRound className='text-muted-foreground size-4 shrink-0' />
      <div className='min-w-0 flex-1 space-y-0.5'>
        <div className='flex items-center gap-2'>
          <span className='truncate text-sm font-medium'>{passkey.name}</span>
          {passkey.backed_up ? (
            <Badge variant='secondary'>{t('Synced')}</Badge>
          ) : passkey.device_type === 'singleDevice' ? (
            <Badge variant='outline'>{t('This device only')}</Badge>
          ) : null}
        </div>
        <p className='text-muted-foreground text-xs'>
          {t('Added {{time}}', { time: formatTimestamp(passkey.created_at) })}
          {' · '}
          {passkey.last_used_at
            ? t('Last used {{time}}', {
                time: formatTimestamp(passkey.last_used_at),
              })
            : t('Never used')}
        </p>
      </div>
      <Button
        variant='ghost'
        size='icon'
        className='text-muted-foreground hover:text-destructive size-8'
        aria-label={t('Remove Passkey')}
        onClick={props.onRemove}
      >
        <Trash2 className='size-4' />
      </Button>
    </div>
  )
}

function AddPasskeyForm(props: { onCancel: () => void; onAdded: () => Promise<void> }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const username = useAuthStore((state) => state.auth.user?.username ?? '')
  const [busy, setBusy] = useState(false)
  const operation = useRef<AbortController | null>(null)
  useEffect(() => () => operation.current?.abort(), [])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!password || operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    try {
      const begin = await beginPasskeyRegistration(password, controller.signal)
      if (!begin.flow_token) {
        throw new AuthOperationError('Registration flow expired. Please try again.')
      }
      const credential = (await createCredential(
        prepareCredentialCreationOptions(begin.options ?? begin),
        controller.signal
      )) as PublicKeyCredential | null
      const attestation = buildRegistrationResult(credential)
      if (!attestation) {
        throw new AuthOperationError('Passkey registration was cancelled')
      }
      await finishPasskeyRegistration(begin.flow_token, attestation, name.trim(), controller.signal)
      toast.success(t('Passkey added'))
      await props.onAdded()
    } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        toast.info(t('Passkey registration was cancelled'))
      } else if (error instanceof DOMException && error.name === 'InvalidStateError') {
        // excludeCredentials 命中：这台设备上已经有本站的 Passkey
        toast.error(t('This device already has a Passkey for this site'))
      } else {
        toast.error(t(AuthOperationError.from(error, 'Failed to register Passkey').message))
      }
    } finally {
      if (operation.current === controller) operation.current = null
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-3 rounded-md border p-3'>
      {/* 密码管理器会把密码框前面的文本框当成用户名：放一个隐藏的用户名框，让它知道这是当前账号的密码，
          “名称”框标成 off，免得弹出同一主域名下其他网站的账号 */}
      <input
        type='text'
        name='username'
        autoComplete='username'
        value={username}
        readOnly
        hidden
      />
      <div className='space-y-1.5'>
        <Label htmlFor='passkey-name'>{t('Name')}</Label>
        <Input
          id='passkey-name'
          name='passkey-name'
          autoComplete='off'
          data-1p-ignore
          data-lpignore='true'
          value={name}
          maxLength={50}
          placeholder={t('e.g. iCloud Keychain, YubiKey')}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
          autoFocus
        />
      </div>
      <div className='space-y-1.5'>
        <Label htmlFor='passkey-password'>{t('Current password')}</Label>
        <PasswordInput
          id='passkey-password'
          name='password'
          value={password}
          autoComplete='current-password'
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
        <p className='text-muted-foreground text-xs'>
          {t('Confirm your password before adding a new sign-in method')}
        </p>
      </div>
      <div className='flex justify-end gap-2'>
        <Button type='button' variant='ghost' onClick={props.onCancel} disabled={busy}>
          {t('Cancel')}
        </Button>
        <Button type='submit' disabled={busy || !password}>
          {busy && <Loader2 className='size-4 animate-spin' />}
          {t('Continue')}
        </Button>
      </div>
    </form>
  )
}
