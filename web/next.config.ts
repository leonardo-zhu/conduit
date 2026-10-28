import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  // NewAPI 前端的请求常带结尾斜杠（如 /api/token/），不要先 308 重定向一次
  skipTrailingSlashRedirect: true,
}

export default nextConfig
