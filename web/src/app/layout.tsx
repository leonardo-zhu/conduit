import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import '@/styles/index.css'

import { ClientRoot } from './client-root'

export const metadata: Metadata = {
  title: 'Conduit',
  description: 'Conduit LLM gateway console.',
  icons: { icon: '/favicon.ico' },
}

// 首帧前就确定主题，避免闪白。与 ThemeProvider 和 THEME_STORAGE_KEYS.mode 保持一致（源自 NewAPI 的 index.html）
const themeScript = `(function () {
  var theme = 'system'
  try { theme = localStorage.getItem('newapi:theme:v1:mode') || 'system' } catch (e) {}
  if (theme !== 'dark' && theme !== 'light') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  document.documentElement.classList.add(theme)
})()`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='zh-CN' suppressHydrationWarning>
      <head>
        <meta name='google' content='notranslate' />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body translate='no' className='notranslate'>
        <ClientRoot>{children}</ClientRoot>
      </body>
    </html>
  )
}
