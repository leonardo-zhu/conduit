/**
 * Conduit: 配置变更记录页。后台对应用、别名、密钥、服务商、Passkey 的增删改，
 * 每条一张卡片：什么时候、谁（登录方式和 IP）、对哪个对象做了什么、字段改前 → 改后。
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowRight, History } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { getConfigChanges, type ConfigChange, type FieldChange } from '@/lib/api'
import { formatDateTimeObject } from '@/lib/time'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 50

const SUBJECT_LABELS: Record<ConfigChange['subject_type'], string> = {
  app: 'change.subject.app',
  alias: 'change.subject.alias',
  token: 'change.subject.token',
  upstream: 'change.subject.upstream',
  passkey: 'change.subject.passkey',
}

const ACTION_LABELS: Record<ConfigChange['action'], string> = {
  create: 'change.action.create',
  update: 'change.action.update',
  delete: 'change.action.delete',
  enable: 'change.action.enable',
  disable: 'change.action.disable',
  regenerate_key: 'change.action.regenerate_key',
  copy: 'change.action.copy',
}

const ACTION_TONE: Partial<Record<ConfigChange['action'], string>> = {
  create: 'text-emerald-600 dark:text-emerald-400',
  delete: 'text-destructive',
  disable: 'text-amber-600 dark:text-amber-400',
  regenerate_key: 'text-amber-600 dark:text-amber-400',
}

function useFormatValue() {
  const { t } = useTranslation()
  return (change: FieldChange, value: string | undefined) => {
    if (value === undefined || value === '') return null
    if (change.time) {
      const seconds = Number(value)
      if (seconds === -1) return t('Never')
      return formatDateTimeObject(new Date(seconds * 1000))
    }
    return value
  }
}

function ChangeLine({ change }: { change: FieldChange }) {
  const { t } = useTranslation()
  const format = useFormatValue()
  const from = format(change, change.from)
  const to = format(change, change.to)
  return (
    <div className='grid grid-cols-[minmax(4.5rem,auto)_1fr] gap-x-3 text-sm'>
      <span className='text-muted-foreground'>{change.label}</span>
      <span className='flex min-w-0 flex-wrap items-center gap-x-1.5 break-all'>
        {from !== null ? (
          <span className='text-muted-foreground line-through decoration-1'>
            {from}
          </span>
        ) : null}
        {from !== null && to !== null ? (
          <ArrowRight className='text-muted-foreground size-3.5 shrink-0' />
        ) : null}
        {to !== null ? <span>{to}</span> : null}
        {from !== null && to === null ? (
          <span className='text-muted-foreground'>({t('change.removed')})</span>
        ) : null}
      </span>
    </div>
  )
}

function ChangeCard({ item }: { item: ConfigChange }) {
  const { t } = useTranslation()
  const at = new Date(item.at * 1000)
  const actor = item.actor === 'passkey' ? 'Passkey' : item.actor ? t('change.via_password') : ''
  return (
    <div className='flex flex-col gap-2 border-b px-1 py-3 last:border-b-0'>
      <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
        <Badge variant='outline'>{t(SUBJECT_LABELS[item.subject_type])}</Badge>
        <span className='font-medium break-all'>{item.subject_name}</span>
        <span className={cn('text-sm', ACTION_TONE[item.action])}>
          {t(ACTION_LABELS[item.action])}
        </span>
      </div>
      {item.changes.length ? (
        <div className='flex flex-col gap-1'>
          {item.changes.map((change, i) => (
            <ChangeLine key={i} change={change} />
          ))}
        </div>
      ) : null}
      <div className='text-muted-foreground text-xs'>
        {formatDateTimeObject(at)}
        {actor ? ` · ${actor}` : null}
        {item.ip ? ` · ${item.ip}` : null}
      </div>
    </div>
  )
}

export function ConfigChanges() {
  const { t } = useTranslation()
  const [subjectType, setSubjectType] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['config-changes', subjectType, keyword, page],
    queryFn: () =>
      getConfigChanges({
        p: page,
        page_size: PAGE_SIZE,
        subject_type: subjectType,
        keyword,
      }),
    placeholderData: keepPreviousData,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Change history')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <NativeSelect
              value={subjectType}
              onChange={(e) => {
                setSubjectType(e.target.value)
                setPage(1)
              }}
              aria-label={t('Object type')}
            >
              <NativeSelectOption value=''>{t('All objects')}</NativeSelectOption>
              {Object.entries(SUBJECT_LABELS).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {t(label)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Input
              className='h-8 w-full sm:w-64'
              placeholder={t('Search name or value')}
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value)
                setPage(1)
              }}
            />
          </div>

          <div
            className={cn(
              'rounded-lg border px-3 transition-opacity',
              isFetching && !isLoading && 'opacity-60'
            )}
          >
            {items.length === 0 ? (
              <Empty className='min-h-48 border-0'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <History />
                  </EmptyMedia>
                  <EmptyTitle>
                    {isLoading ? t('Loading...') : t('No changes yet')}
                  </EmptyTitle>
                  {!isLoading ? (
                    <EmptyDescription>
                      {t(
                        'Changes to apps, aliases, API keys, providers and passkeys made in this console are recorded here'
                      )}
                    </EmptyDescription>
                  ) : null}
                </EmptyHeader>
              </Empty>
            ) : (
              items.map((item) => <ChangeCard key={item.id} item={item} />)
            )}
          </div>

          {total > 0 ? (
            <div className='text-muted-foreground flex items-center justify-between gap-2 text-sm'>
              <span>{t('change.total', { count: total })}</span>
              <div className='flex items-center gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {t('change.previous')}
                </Button>
                <span className='tabular-nums'>
                  {page} / {pages}
                </span>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={page >= pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t('change.next')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
