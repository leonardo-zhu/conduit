# Conduit：管理后台 + 网关，一个 Next.js standalone 服务。CI 在 ARM runner 上构建 linux/arm64。
#
# 运行时需要的环境变量见 .env.example；数据（SQLite）在 /data，要挂成卷。
# 默认只监听 127.0.0.1，由同机的 Caddy 反代（R4S 上用 network_mode: host）。

FROM node:24.15.0-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:24.15.0-alpine
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3012 \
    HOSTNAME=127.0.0.1 \
    CONDUIT_DATA_DIR=/data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# 从 NewAPI 导入令牌，在服务器上用 docker compose run 跑一次，见 docs/setup.md
COPY --chown=node:node scripts/import-newapi.mjs ./scripts/
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3012
HEALTHCHECK --interval=60s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -q -O - "http://127.0.0.1:${PORT}/api/status" | grep -q '"success":true' || exit 1
CMD ["node", "server.js"]
