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

runner、部署目录（`/opt/stacks/conduit`，组 32772 可写）在 2026-10-26 部署 NewAPI 时已经准备好，不用再做。

## 从 NewAPI 切换过来（只做一次）

以下在 R4S 上执行（`ssh istoreos`）。合并到 master 之前做完第 1–3 步。

1. **补齐 `.env`**。在自己电脑上进入仓库的 `web/` 目录生成密钥：

   ```bash
   node scripts/hash-password.mjs   # ADMIN_PASSWORD_HASH，密码至少 12 位
   openssl rand -base64 32          # CONDUIT_MASTER_KEY
   ```

   然后按仓库根目录的 `.env.example` 编辑 `/opt/stacks/conduit/.env`：加上 `ADMIN_USERNAME`、`ADMIN_PASSWORD_HASH`、`CONDUIT_MASTER_KEY`、`PASSKEY_ORIGIN`；原来的 `SESSION_SECRET` 可以保留（至少 32 个字符），`CRYPTO_SECRET` 等 NewAPI 的配置可以删掉。值里不能有 `$`。

   网关事件的 Telegram 推送不用在这里配机器人令牌：`compose.yaml` 会加载 `/opt/stacks/.secrets/global.env`，用里面 OpenClaw 默认机器人的 `TELEGRAM_BOT_TOKEN_DEFAULT`；`.env` 里只用 `CONDUIT_TELEGRAM_CHAT_ID` 指定发到哪个频道，见 [alerts.md](alerts.md)。

2. **数据目录**（容器里以 node 用户运行，uid 1000）：

   ```bash
   mkdir -p /opt/conduit/web/data && chown 1000:1000 /opt/conduit/web/data
   ```

3. **Caddy**：把 `/opt/stacks/caddy/Caddyfile` 里 `conduit.r4s.leonardo-zhu.me` 那一段换成 `deploy/Caddyfile.snippet` 的内容（指向 3012，去掉原来的 `/_home`），然后：

   ```bash
   cd /opt/stacks/caddy
   docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
   ```

   在新服务起来之前，这个域名会返回 502。

4. **部署**：把分支合并到 `master` 并推送。部署时 `--remove-orphans` 会删掉旧的 `conduit-new-api` 和 `conduit-adapter` 容器。

5. **配置**：打开 `https://conduit.r4s.leonardo-zhu.me`，用 `.env` 里的账号登录。在头像菜单里注册 Passkey（可选），然后建上游（填真实密钥和 OpenAI 兼容地址；Responses API 选原生支持、网关转换或不提供；上游有 Anthropic 接口就再填 Anthropic 兼容地址）、应用和别名、令牌。

6. **（可选）导入 NewAPI 的令牌**：想沿用 NewAPI 里发过的令牌时才需要。NewAPI 的数据还在 `/opt/conduit/new-api/data`，先预览，确认后加 `--apply`：

   ```bash
   cd /opt/stacks/conduit
   docker compose run --rm -v /opt/conduit/new-api/data:/newapi:ro web \
     node scripts/import-newapi.mjs /newapi/one-api.db --map root=vita
   ```

7. 确认没问题后，`/opt/conduit/new-api/` 可以删掉。

## 更新与回滚

- `web/` 或 `compose.yaml` 有改动时，推到 `master` 就会自动部署。
- 回滚：在服务器上指定旧的 commit sha，

  ```bash
  ssh istoreos 'cd /opt/stacks/conduit && WEB_TAG=<旧 sha> docker compose up -d web'
  ```

  或者在 GitHub 上 revert 后重新推送。数据库迁移只增不改，旧版本能读新版本的库（不认识的列会被忽略）。
