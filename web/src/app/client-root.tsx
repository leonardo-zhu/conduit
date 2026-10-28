'use client'

import dynamic from 'next/dynamic'

// 照搬的前端是纯 SPA，模块初始化就会读 localStorage / window，所以整棵树只在浏览器里渲染
export const ClientRoot = dynamic(() => import('./app-shell').then((m) => m.AppShell), {
  ssr: false,
})
