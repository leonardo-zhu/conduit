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
import { flexRender, type Row } from '@tanstack/react-table'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadgeTypeContext } from '@/components/status-badge'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

import { CHANNEL_STATUS } from '../constants'
import type { Channel } from '../types'
import { ChannelRowActionsLayoutContext } from './channel-row-actions-context'
import { useChannels } from './channels-provider'

const SENSITIVE_MASK = '••••'

/**
 * Bespoke channel card for the card view. Reuses every column's existing cell
 * renderer via `flexRender`, so the table's information and interactions are
 * preserved: row selection, endpoint badges, id, name/remark + warning
 * icons, status (with tooltips), models, response/test times, and the per-row
 * actions menu.
 *
 * Conduit: 去掉了优先级、权重、余额、分组和标签聚合；底部改为显示这个上游承载的模型（别名）。
 */
function ChannelCardComponent({
  row,
  isSelected,
}: {
  row: Row<Channel>
  isSelected: boolean
}) {
  const { t } = useTranslation()
  const { sensitiveVisible } = useChannels()
  const { copyToClipboard } = useCopyToClipboard()
  const cells = row.getAllCells()

  const renderCell = (id: string) => {
    const cell = cells.find((c) => c.column.id === id)
    if (!cell || !cell.column.columnDef.cell) {
      return null
    }
    return flexRender(cell.column.columnDef.cell, cell.getContext())
  }

  const selectCell = renderCell('select')
  const endpointsCell = renderCell('endpoints')
  const nameCell = renderCell('name')
  const statusCell = renderCell('status')
  const actionsCell = renderCell('actions')
  const modelsCell = renderCell('models')
  const responseCell = renderCell('response_time')
  const testCell = renderCell('test_time')

  const labelClass = 'text-muted-foreground text-[11px] font-medium select-none'

  // In card view the enable/disable state is already conveyed by the inline
  // power toggle, so the plain "Enabled"/"Disabled" badge is redundant. Keep
  // only the informative states (e.g. auto-disabled, unknown).
  const showStatusBadge =
    row.original.status !== CHANNEL_STATUS.ENABLED &&
    row.original.status !== CHANNEL_STATUS.MANUAL_DISABLED

  return (
    <ChannelRowActionsLayoutContext.Provider value='card'>
      <div
        data-state={isSelected ? 'selected' : undefined}
        className='flex min-w-0 flex-col gap-3'
      >
        {/* Row 1: selection + name, with status badge + actions menu */}
        <div className='flex items-start justify-between gap-2'>
          <div className='flex min-w-0 flex-1 items-start gap-2'>
            {selectCell && <span className='shrink-0'>{selectCell}</span>}
            <div className='min-w-0 overflow-hidden text-sm'>
              <div className={labelClass}>
                #{sensitiveVisible ? row.original.id : SENSITIVE_MASK}
                {row.original.slug && (
                  <>
                    {' · '}
                    {/* 标识要写进应用配置（标识/模型名），点一下复制，也能手动选中 */}
                    <button
                      type='button'
                      title={t('Click to copy')}
                      className='hover:text-foreground cursor-copy font-mono select-text'
                      onClick={(e) => {
                        e.stopPropagation()
                        void copyToClipboard(row.original.slug!)
                      }}
                    >
                      {row.original.slug}
                    </button>
                  </>
                )}
              </div>
              {nameCell}
            </div>
          </div>
          <div className='flex shrink-0 items-center gap-1.5'>
            {showStatusBadge && statusCell}
            {actionsCell}
          </div>
        </div>

        <div className='-ml-1.5 min-w-0'>{endpointsCell}</div>

        <StatusBadgeTypeContext.Provider value='text'>
          <dl className='grid grid-cols-2 gap-x-3 gap-y-1'>
            <dt className={labelClass}>{t('Response')}</dt>
            <dt className={labelClass}>{t('Last Tested')}</dt>
            <dd className='min-w-0 text-sm tabular-nums [&_[data-slot=status-badge]]:!ml-0'>
              {responseCell ?? <span className='text-muted-foreground'>-</span>}
            </dd>
            <dd className='min-w-0 text-sm [&_[data-slot=status-badge]]:!ml-0'>
              {testCell ?? <span className='text-muted-foreground'>-</span>}
            </dd>
          </dl>
        </StatusBadgeTypeContext.Provider>

        <div className='min-w-0'>
          <div className={labelClass}>{t('Models')}</div>
          {modelsCell ?? <span className='text-muted-foreground text-sm'>-</span>}
        </div>
      </div>
    </ChannelRowActionsLayoutContext.Provider>
  )
}

/**
 * Memoized so each card only re-renders when its own react-table row reference
 * changes, instead of every card re-rendering whenever the parent table state
 * (filters, pagination, sensitive toggle, etc.) updates.
 */
export const ChannelCard = memo(ChannelCardComponent)
