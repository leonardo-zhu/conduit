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

import type { TFunction } from 'i18next'
import { Bell, CircleAlert, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import type { GatewayEvent } from '@/lib/api'
import { useNavigate } from '@/lib/router'
import { formatDateTimeObject } from '@/lib/time'
import { cn } from '@/lib/utils'

// Conduit: 改成网关事件列表（上游异常、额度告急、错误率突增），原来是 NewAPI 的通知和公告两个标签页

interface NotificationPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  unreadCount: number
  events: GatewayEvent[]
  loading: boolean
  onMarkRead: (id: number) => void
  onMarkAllRead: () => void
  className?: string
}

/**
 * Get relative time string from a date
 */
function getRelativeTime(publishDate: string | Date, t: TFunction): string {
  if (!publishDate) return ''

  const now = new Date()
  const pubDate = new Date(publishDate)

  // If invalid date, return original string
  if (Number.isNaN(pubDate.getTime())) {
    return typeof publishDate === 'string' ? publishDate : ''
  }

  const diffMs = now.getTime() - pubDate.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)
  const diffYears = Math.floor(diffDays / 365)

  // If future time, show specific date
  if (diffMs < 0) return formatDateTimeObject(pubDate)

  // Return relative time based on difference
  if (diffSeconds < 60) return t('Just now')
  if (diffMinutes < 60) {
    return diffMinutes === 1
      ? t('1 minute ago')
      : t('{{count}} minutes ago', { count: diffMinutes })
  }
  if (diffHours < 24) {
    return diffHours === 1
      ? t('1 hour ago')
      : t('{{count}} hours ago', { count: diffHours })
  }
  if (diffDays < 7) {
    return diffDays === 1
      ? t('1 day ago')
      : t('{{count}} days ago', { count: diffDays })
  }
  if (diffWeeks < 4) {
    return diffWeeks === 1
      ? t('1 week ago')
      : t('{{count}} weeks ago', { count: diffWeeks })
  }
  if (diffMonths < 12) {
    return diffMonths === 1
      ? t('1 month ago')
      : t('{{count}} months ago', { count: diffMonths })
  }
  if (diffYears < 2) return t('1 year ago')

  // Over 2 years, show specific date
  return formatDateTimeObject(pubDate)
}

function EventItem({
  event,
  onSelect,
  t,
}: {
  event: GatewayEvent
  onSelect: (event: GatewayEvent) => void
  t: TFunction
}) {
  const unread = event.read_at === 0
  const lastAt = new Date(event.last_at * 1000)
  const Icon = event.level === 'error' ? CircleAlert : TriangleAlert

  return (
    <button
      type='button'
      onClick={() => onSelect(event)}
      className='hover:bg-muted/60 flex w-full items-start gap-3 rounded-md px-2 py-3 text-start transition-colors'
    >
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          event.level === 'error' ? 'text-destructive' : 'text-amber-500'
        )}
      />
      <div className='flex min-w-0 flex-1 flex-col gap-1'>
        <div
          className={cn(
            'text-sm',
            unread ? 'font-medium' : 'text-muted-foreground'
          )}
        >
          {event.title}
        </div>
        {event.detail ? (
          <div className='text-muted-foreground line-clamp-2 text-xs break-all'>
            {event.detail}
          </div>
        ) : null}
        <div
          className='text-muted-foreground text-xs'
          title={formatDateTimeObject(lastAt)}
        >
          {event.count > 1
            ? `${t('{{count}} times', { count: event.count })} · `
            : null}
          {getRelativeTime(lastAt, t)}
        </div>
      </div>
      {unread ? (
        <span className='bg-primary mt-1.5 size-2 shrink-0 rounded-full' />
      ) : null}
    </button>
  )
}

export function NotificationPopover({
  open,
  onOpenChange,
  unreadCount,
  events,
  loading,
  onMarkRead,
  onMarkAllRead,
  className,
}: NotificationPopoverProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const handleSelect = (event: GatewayEvent) => {
    if (event.read_at === 0) onMarkRead(event.id)
    onOpenChange(false)
    if (event.link) navigate({ href: event.link })
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            className={cn('relative size-9', className)}
            aria-label={t('Notifications')}
          />
        }
      >
        <Bell className='size-[1.2rem]' />
        {unreadCount > 0 ? (
          <Badge
            variant='destructive'
            className='absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center px-1 text-[10px] font-semibold tabular-nums'
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </Badge>
        ) : null}
      </PopoverTrigger>

      <PopoverContent
        align='end'
        sideOffset={8}
        className='w-[min(26rem,calc(100vw-1rem))] gap-2 p-3'
      >
        <PopoverHeader className='flex-row items-center justify-between gap-2 px-1'>
          <div className='flex flex-col gap-1'>
            <PopoverTitle>{t('Gateway alerts')}</PopoverTitle>
            <p className='text-muted-foreground text-xs'>
              {t('Upstream errors, quota usage and failure spikes')}
            </p>
          </div>
          {unreadCount > 0 ? (
            <Button variant='ghost' size='sm' onClick={onMarkAllRead}>
              {t('Mark all as read')}
            </Button>
          ) : null}
        </PopoverHeader>

        {events.length === 0 ? (
          <Empty className='min-h-48 border-0 p-4'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Bell />
              </EmptyMedia>
              <EmptyTitle>
                {loading ? t('Loading...') : t('No alerts')}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ScrollArea className='h-[min(52vh,28rem)] pr-3'>
            <div className='flex flex-col'>
              {events.map((event, idx) => (
                <div key={event.id}>
                  <EventItem event={event} onSelect={handleSelect} t={t} />
                  {idx < events.length - 1 ? <Separator /> : null}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  )
}
