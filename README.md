# Conduit

自托管的多应用 LLM 网关。所有应用（Vita 是第一个，之后的小服务也一样）的模型调用都从这里走：鉴权、额度、模型别名、协议转换、用量记录、管理后台。

## 架构

```
应用 ──/v1/responses 或 /v1/chat/completions + 令牌──▶ Caddy (conduit.r4s.leonardo-zhu.me)
                                                          │
                                                          ▼
                                    web :3012（Next.js，本仓库 web/）
                     管理后台 · 令牌 · 额度 · 别名 · 用量 · 协议转换 · SQLite
                                  │                          │
                       原生 Responses 的上游           只支持 Chat 的上游
                          （直接透传）              （网关转换 Responses ↔ Chat）
                                  │                          │
                                  ▼                          ▼
                              火山方舟                 MiniMax / Nous
```

一个服务、一个 SQLite 库。上游密钥用主密钥加密后存库，令牌只存哈希。

## 目录

```
compose.yaml          部署时由 CI 拷到 R4S 的 /opt/stacks/conduit/
.env.example          服务器 .env 的模板
.github/workflows/    构建 web 镜像推 GHCR，再由 R4S 的 self-hosted runner 部署
deploy/
  Caddyfile.snippet   R4S 的 Caddyfile 里 conduit.r4s… 那一段
web/                  管理后台 + 网关（前端取自 NewAPI，AGPL-3.0，见 web/README.md）
  src/server/api/     管理接口
  src/server/gateway/ 网关数据面：鉴权、别名、额度、转发、协议转换、记账
  scripts/            冒烟测试、本地示例数据、NewAPI 令牌导入
docs/
  setup.md            部署
  apps.md             新应用接入约定
  rewrite-plan.md     从 NewAPI + adapter 重构为本服务的计划
  progress.md         进度记录
```

## 本地开发

```bash
cd web
cp .env.example .env.local
pnpm install
pnpm dev                     # http://localhost:3020
node scripts/seed-dev.mjs    # 另开终端，写入示例数据
```

## 部署

见 [docs/setup.md](docs/setup.md)。
