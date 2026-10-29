/**
 * Conduit: 头像菜单里的“关于”。NewAPI NOTICE（AGPLv3 第 7(b) 条附加条款）要求界面上保留的
 * 署名和原项目链接放在这里，不要删；同时按 AGPLv3 第 13 条给出本项目的源码地址。
 */
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const linkClassName = 'hover:text-foreground underline underline-offset-2'

export function AboutDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Conduit</DialogTitle>
          <DialogDescription>
            {t('A self-hosted LLM gateway for personal apps')}
          </DialogDescription>
        </DialogHeader>
        <div className='text-muted-foreground flex flex-col gap-3 text-sm'>
          <p>
            Frontend design and development by New API contributors.{' '}
            <a
              href='https://github.com/QuantumNous/new-api'
              target='_blank'
              rel='noreferrer'
              className={linkClassName}
            >
              github.com/QuantumNous/new-api
            </a>
          </p>
          <p>
            {t('Licensed under AGPL-3.0-or-later. Source code:')}{' '}
            <a
              href='https://github.com/leonardo-zhu/conduit'
              target='_blank'
              rel='noreferrer'
              className={linkClassName}
            >
              github.com/leonardo-zhu/conduit
            </a>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
