import { Check, Copy, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { copyToClipboard } from '@/lib/copy-to-clipboard'

/** 新建或重新生成令牌后，显示一次完整密钥。关掉后服务端也查不到明文 */
export type RevealedKey = { name: string; key: string }

export function TokenKeyDialog(props: {
  revealed: RevealedKey | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { revealed } = props
  const [copied, setCopied] = useState(false)
  const fullKey = revealed ? `sk-${revealed.key}` : ''

  const handleCopy = async () => {
    if (await copyToClipboard(fullKey)) setCopied(true)
  }

  return (
    <Dialog
      open={!!revealed}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose()
          setCopied(false)
        }
      }}
    >
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('Save the key for {{name}}', { name: revealed?.name })}</DialogTitle>
          <DialogDescription>
            {t('Put it into the app or device now.')}
          </DialogDescription>
        </DialogHeader>
        <div className='flex items-center gap-2'>
          <input
            readOnly
            value={fullKey}
            autoFocus
            onFocus={(e) => e.target.select()}
            className='bg-muted/50 min-w-0 flex-1 rounded-md border px-3 py-2 font-mono text-xs outline-none'
          />
          <Button variant='outline' size='icon' onClick={handleCopy} aria-label={t('Copy API key')}>
            {copied ? <Check className='size-4 text-green-600' /> : <Copy className='size-4' />}
          </Button>
        </div>
        <p className='text-warning flex items-start gap-2 text-sm'>
          <TriangleAlert className='mt-0.5 size-4 shrink-0' />
          {t('This is the only time the key is shown. If you lose it, regenerate it from the key menu.')}
        </p>
        <DialogFooter>
          <Button
            onClick={() => {
              props.onClose()
              setCopied(false)
            }}
          >
            {copied ? t('Done') : t('I have saved it')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
