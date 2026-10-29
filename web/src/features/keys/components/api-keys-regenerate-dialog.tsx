import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { handleServerError } from '@/lib/handle-server-error'

import { regenerateApiKey } from '../api'
import { useApiKeys } from './api-keys-provider'

/** Conduit: 重新生成密钥。旧密钥立即失效，新密钥在 TokenKeyDialog 里显示一次 */
export function ApiKeysRegenerateDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentRow, setRevealed, triggerRefresh } = useApiKeys()
  const [isLoading, setIsLoading] = useState(false)

  const handleConfirm = async () => {
    if (!currentRow) return
    setIsLoading(true)
    try {
      const result = await regenerateApiKey(currentRow.id)
      if (!result.success || !result.data?.key) {
        handleServerError(result, t('Failed to regenerate the key'))
        return
      }
      setOpen(null)
      setRevealed({ name: currentRow.name, key: result.data.key })
      triggerRefresh()
    } catch (error) {
      handleServerError(error, t('Failed to regenerate the key'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <ConfirmDialog
      open={open === 'regenerate'}
      onOpenChange={(value) => !value && setOpen(null)}
      title={t('Regenerate key')}
      desc={t(
        'The current key of "{{name}}" stops working immediately. Devices using it must be updated with the new key.',
        { name: currentRow?.name }
      )}
      confirmText={t('Regenerate')}
      destructive
      isLoading={isLoading}
      handleConfirm={handleConfirm}
      className='sm:max-w-md'
    />
  )
}
