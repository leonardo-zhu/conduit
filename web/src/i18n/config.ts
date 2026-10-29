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
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import { convertDetectedLanguage, LANGUAGE_STORAGE_KEY } from './languages'
import conduitEn from './locales/conduit.en.json'
import conduitZh from './locales/conduit.zh.json'
import en from './locales/en.json'
import zhCN from './locales/zh.json'

/**
 * Conduit 把 NewAPI 的“渠道”叫“服务商”。原翻译里有三百多条提到渠道，
 * 在这里统一替换，不逐条覆盖；conduit.*.json 里的文案不受影响。
 */
function renameChannels(
  translation: Record<string, string>,
  replace: (value: string) => string
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(translation).map(([key, value]) => [key, replace(value)])
  )
}

const enRenamed = renameChannels(en.translation, (v) =>
  v.replaceAll('Channel', 'Provider').replaceAll('channel', 'provider')
)
const zhRenamed = renameChannels(zhCN.translation, (v) =>
  v.replaceAll('渠道', '服务商')
)

// Conduit 新增或改写的文案放在 conduit.*.json，覆盖在 NewAPI 原翻译之上
export const resources = {
  en: { translation: { ...enRenamed, ...conduitEn } },
  zhCN: { translation: { ...zhRenamed, ...conduitZh } },
} as const

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'zhCN'],
    load: 'currentOnly',
    nsSeparator: false, // Allow literal colons in keys (e.g., URLs, labels)
    debug: process.env.NODE_ENV === 'development',
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
    // Conduit: 默认跟随浏览器 / 系统语言，检测结果不写回 localStorage；
    // 只有在语言切换器里手动选了才存（见 language-switcher.tsx），选“跟随系统”会清掉
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: [],
      // Browsers report `zh-CN`/`zh-TW`/`zh`; map them onto our `zhCN`/`zhTW`
      // codes (non-Chinese codes pass through for normal supportedLngs matching).
      convertDetectedLanguage,
    },
  })

export default i18n
