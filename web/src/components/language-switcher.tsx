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
import { Languages, Check } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  INTERFACE_LANGUAGE_OPTIONS,
  LANGUAGE_STORAGE_KEY,
  normalizeInterfaceLanguage,
} from '@/i18n/languages'
import { cn } from '@/lib/utils'

function readStoredLanguage(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * Conduit: 默认跟随浏览器 / 系统语言。手动选了某个语言才存进 localStorage，
 * 选“跟随系统”清掉记录、重新检测。不再存到服务端（Conduit 没有这个接口）
 */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const [stored, setStored] = useState(readStoredLanguage)
  const currentLanguage = normalizeInterfaceLanguage(i18n.language)
  const handleChangeLanguage = useCallback(
    async (code: string | null) => {
      try {
        if (code) localStorage.setItem(LANGUAGE_STORAGE_KEY, code)
        else localStorage.removeItem(LANGUAGE_STORAGE_KEY)
      } catch {
        // 存不了就只对这次生效
      }
      setStored(code)
      // 不传语言时 i18next 重新走检测（此时只剩浏览器语言）
      await i18n.changeLanguage(code ?? undefined)
    },
    [i18n]
  )

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={<Button variant='ghost' size='icon' className='h-9 w-9' />}
      >
        <Languages className='size-[1.2rem]' />
        <span className='sr-only'>{t('Change language')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onClick={() => handleChangeLanguage(null)}>
          {t('Follow system')}
          <Check size={14} className={cn('ms-auto', stored && 'hidden')} />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {INTERFACE_LANGUAGE_OPTIONS.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => handleChangeLanguage(lang.code)}
          >
            {lang.label}
            <Check
              size={14}
              className={cn(
                'ms-auto',
                (!stored || currentLanguage !== lang.code) && 'hidden'
              )}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
