# 部署

目标机器：R4S（iStoreOS，aarch64，host 网络，所有 stack 在 `/opt/stacks/<name>/`）。R4S 的通用约束见 `~/HomeLab/r4s/CLAUDE.md`。

## 资源和端口

| 服务 | 端口 | 内存上限 | 说明 |
|---|---|---|---|
| web | 3012，仅 127.0.0.1 | 256MB | Next.js standalone，管理后台 + 网关。上线后用 `docker stats --no-stream conduit-web` 看实际占用 |

只监听 127.0.0.1，经 Caddy 访问：令牌的 IP 白名单和登录限速信任 `X-Forwarded-For`，不能让外部直连。

数据：SQLite 在 `/opt/conduit/web/data/conduit.db`（TF 卡上），每个请求写一条用量记录。

## 部署方式

GitHub Actions（`.github/workflows/deploy.yml`）：

1. `build`：在 GitHub 的 arm64 runner 上构建 `web/`，推到 `ghcr.io/leonardo-zhu/conduit-web`（`latest` 和 commit sha 两个 tag）。
2. `deploy`：在 R4S 的 self-hosted runner（`r4s-conduit`）上，把仓库里的 `compose.yaml` 拷到 `/opt/stacks/conduit/`，然后 `docker compose pull && up -d --remove-orphans`。

`compose.yaml` 以仓库为准，服务器上的副本每次部署都会被覆盖；`.env` 只在服务器上维护，不进仓库。只改了文档的提交不会触发部署。

runner（`r4s-conduit`）和部署目录（`/opt/stacks/conduit`，组 32772 可写）在 2026-10-26 部署 NewAPI 时准备好的。

## 服务器上的配置

2026-10-29 已从 NewAPI 切换过来，以下都已就绪，重建服务器时照着补：

- `/opt/stacks/conduit/.env`：按仓库根目录的 `.env.example` 填 `ADMIN_USERNAME`、`ADMIN_PASSWORD_HASH`（`node web/scripts/hash-password.mjs` 生成，密码至少 12 位）、`SESSION_SECRET`（至少 32 个字符）、`CONDUIT_MASTER_KEY`（`openssl rand -base64 32`，**丢了要在后台重填所有服务商密钥**）、`PASSKEY_ORIGIN`、`CONDUIT_TELEGRAM_CHAT_ID`。值里不能有 `$`。
- Telegram 推送的机器人令牌不在 `.env` 里：`compose.yaml` 加载 `/opt/stacks/.secrets/global.env`，用 OpenClaw 默认机器人的 `TELEGRAM_BOT_TOKEN_DEFAULT`，见 [alerts.md](alerts.md)。
- 数据目录：`mkdir -p /opt/conduit/web/data && chown 1000:1000 /opt/conduit/web/data`（容器里以 node 用户运行）。
- Caddy：`/opt/stacks/caddy/Caddyfile` 里 `conduit.r4s.leonardo-zhu.me` 一段用 `deploy/Caddyfile.snippet` 的内容。改完先 `caddy validate` 再 `caddy reload`（在 `/opt/stacks/caddy` 里用 `docker compose exec -T caddy caddy <validate|reload> --config /etc/caddy/Caddyfile --adapter caddyfile`）。
- 首次登录后在头像菜单里注册 Passkey，再建服务商、应用、别名和密钥。
- `web/scripts/import-newapi.mjs` 可以导入 NewAPI 的令牌（切换时没用上）。NewAPI 的旧数据还在 `/opt/conduit/new-api/`，对账确认不回退后删掉。

## 更新与回滚

- `web/` 或 `compose.yaml` 有改动时，推到 `master` 就会自动部署。
- 回滚：在服务器上指定旧的 commit sha，

  ```bash
  ssh istoreos 'cd /opt/stacks/conduit && WEB_TAG=<旧 sha> docker compose up -d web'
  ```

  或者在 GitHub 上 revert 后重新推送。数据库迁移只增不改，旧版本能读新版本的库（不认识的列会被忽略）。
