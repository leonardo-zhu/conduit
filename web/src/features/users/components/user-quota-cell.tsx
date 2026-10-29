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

// Conduit: 应用的 quota 是总额度（0 不限），剩余 = 总额度 - 当前周期已用
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
  const remaining = props.total - props.used
  const formattedRemaining = unlimited
    ? t('Unlimited')
    : formatQuotaWithCurrency(remaining, { showSymbol: false })
  const formattedUsed = formatQuotaWithCurrency(props.used, {
    showSymbol: false,
  })

  return (
    <QuotaDetailsPopover
      title={`${t('Quota')} (${quotaUnit})`}
      triggerLabel={`${t('Available Balance')} ${formattedRemaining}; ${t('Used amount')} ${formattedUsed}`}
      details={[
        { label: t('Available Balance'), value: formattedRemaining },
        { label: t('Total Used'), value: formattedUsed },
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
        <span className={cn(!unlimited && remaining <= 0 && 'text-destructive')}>
          {formattedRemaining}
        </span>
        <span
          data-table-text='secondary'
          className='text-muted-foreground flex items-baseline gap-1 text-xs font-normal'
        >
          <span>{t('Used amount')}</span>
          <span>{formattedUsed}</span>
        </span>
      </span>
    </QuotaDetailsPopover>
  )
}
