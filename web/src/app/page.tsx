import { redirect } from 'next/navigation'

// 自定义首页在阶段 2 迁进来，先直接进后台
export default function Home() {
  redirect('/dashboard')
}
