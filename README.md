# Conduit

自托管的多应用 LLM 网关。所有应用（Vita 是第一个，之后的小服务也一样）的模型调用都从这里走：鉴权、额度、模型别名、协议转换、用量记录、管理后台。

2026-10-29 起在 R4S 上运行（`https://conduit.r4s.leonardo-zhu.me`），替换了原来的 NewAPI + adapter。

## 功能

- **网关**：`/v1/chat/completions`、`/v1/responses`、`/v1/models`，应用自己选调哪个。应用只认别名，别名指向某个上游的某个模型。每个上游都提供 Chat Completions；Responses API 按上游设置：原生支持就直接转发，不支持可以开启网关转换（Chat ↔ Responses，流式照常），也可以不提供。
- **鉴权和额度**：每台设备或服务实例一个令牌（只存哈希），可设过期时间、模型白名单、IP 白名单、额度；应用有共享的总额度，可按月重置。
- **记账**：每个请求记一条用量（只记元数据，不记内容）；上游没返回 usage 时按字符数估算并标出来。
- **管理后台**：账号密码 + Passkey 登录；上游、应用、别名、令牌的管理；使用日志、数据看板。
- **事件提醒**：上游拒绝密钥、限流、连续失败，额度将尽 / 用尽，错误率突增。显示在后台顶栏的铃铛里，新事件推送到 Telegram 频道。见 [docs/alerts.md](docs/alerts.md)。

## 架构

```
应用 ──/v1/responses 或 /v1/chat/completions + 令牌──▶ Caddy (conduit.r4s.leonardo-zhu.me)
                                                          │
                                                          ▼
                                    web :3012（Next.js，本仓库 web/）
                     管理后台 · 令牌 · 额度 · 别名 · 用量 · 协议转换 · SQLite
                                  │
                    /v1/chat/completions → 上游的 /chat/completions（直接转发）
                    /v1/responses        → 上游原生支持：上游的 /responses（直接转发）
                                           开启网关转换：转成 Chat 发给上游，结果转回来
                                           都没有：拒绝，提示改用 /v1/chat/completions
                                  │
                                  ▼
                       上游（不区分服务商：地址 + 密钥）

网关发现异常 ──▶ 事件表（后台铃铛） ──新事件──▶ Telegram 频道
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
  alerts.md           事件提醒和 Telegram 推送
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

推到 `master` 后由 GitHub Actions 自动部署：在 arm64 runner 上构建镜像推 GHCR，再由 R4S 上的 self-hosted runner 拉取并重启。服务器准备、回滚等见 [docs/setup.md](docs/setup.md)。

## 提交约定

- 改动走分支和 PR，合并到 `master` 后自动部署。
- 提交说明用英文，[Conventional Commits](https://www.conventionalcommits.org/) 格式（`fix(web): ...`、`docs: ...`）。
- 由 agent 提交时作者是 bot 身份，提交说明末尾带 `Co-authored-by: Leonardo Zhu <leonardo-zhu@qq.com>`，计入仓库主人的 GitHub contribution。完整规范在 [agent-skills](https://github.com/leonardo-zhu/agent-skills) 仓库的 git-identity skill 里。
