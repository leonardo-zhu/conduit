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
import { useTranslation } from 'react-i18next'

import { QuotaDetailsPopover } from '@/components/quota-details-popover'
import { formatQuotaWithCurrency, getCurrencyDisplay } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

// Conduit: 显示“当前周期已用 / 额度”（0 不限），有上限时带进度条。
// 按月重置的应用，已用是本月的；不重置的是累计
type UserQuotaCellProps = {
  total: number
  used: number
  period?: 'none' | 'month'
}

export function UserQuotaCell(props: UserQuotaCellProps) {
  const { t } = useTranslation()
  useSystemConfigStore((state) => state.config.currency)

  const { meta: currency } = getCurrencyDisplay()
  const quotaUnit = currency.kind === 'tokens' ? t('Tokens') : currency.symbol
  const unlimited = props.total === 0
  const ratio = unlimited ? 0 : Math.min(props.used / props.total, 1)
  const format = (value: number) =>
    formatQuotaWithCurrency(value, { showSymbol: false })
  const formattedUsed = format(props.used)
  const formattedTotal = unlimited ? t('Unlimited') : format(props.total)
  const periodLabel =
    props.period === 'month' ? t('Used this month') : t('Used in total')

  return (
    <QuotaDetailsPopover
      title={`${t('Usage / Quota')} (${quotaUnit})`}
      triggerLabel={`${periodLabel} ${formattedUsed} / ${formattedTotal}`}
      details={[
        { label: periodLabel, value: formattedUsed },
        { label: t('Quota'), value: formattedTotal },
        ...(unlimited
          ? []
          : [{ label: t('Remaining'), value: format(Math.max(props.total - props.used, 0)) }]),
        {
          label: t('Quota period'),
          value:
            props.period === 'month'
              ? t('Reset on the 1st of each month')
              : t('Never reset'),
        },
      ]}
    >
      <span className='grid min-w-0 grid-cols-1 gap-y-1 text-sm tabular-nums'>
        <span>
          {formattedUsed}
          <span className='text-muted-foreground'> / {formattedTotal}</span>
        </span>
        {unlimited ? (
          <span
            data-table-text='secondary'
            className='text-muted-foreground text-xs font-normal'
          >
            {periodLabel}
          </span>
        ) : (
          <span
            className='bg-muted h-1.5 w-full overflow-hidden rounded-full'
            aria-hidden
          >
            <span
              className={cn(
                'block h-full rounded-full',
                ratio >= 1 ? 'bg-destructive' : ratio >= 0.8 ? 'bg-warning' : 'bg-primary'
              )}
              style={{ width: `${ratio * 100}%` }}
            />
          </span>
        )}
      </span>
    </QuotaDetailsPopover>
  )
}
