import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  // NewAPI 前端的请求常带结尾斜杠（如 /api/token/），不要先 308 重定向一次
  skipTrailingSlashRedirect: true,
  // db.ts 里的 path.resolve(CONDUIT_DATA_DIR || '.data') 会让构建把整个项目目录当成依赖拷进
  // standalone，包括本地的 SQLite 库。这些都不该进产物
  outputFileTracingExcludes: {
    '*': ['.data/**', '.env*', 'scripts/**', 'src/**', 'reference/**', '*.tsbuildinfo'],
  },
}

export default nextConfig
