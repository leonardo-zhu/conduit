# 部署与初始配置

目标机器：R4S（iStoreOS，aarch64，host 网络，所有 stack 在 `/opt/stacks/<name>/`）。R4S 的通用约束见 `~/HomeLab/r4s/CLAUDE.md`。

## 资源预算

| 服务 | 内存上限 | 说明 |
|---|---|---|
| new-api | 384MB | Go 单进程 + SQLite，实际常驻预计远低于上限，上线后用 `docker stats` 实测 |
| adapter | 128MB | Bun，无依赖 |
| web | 256MB | 自建的后台 + 网关（Next.js standalone），并行验证期间才启用。本机容器实测空闲约 57MB、压测后约 93MB，R4S 上待实测 |

R4S 没有 swap，可用内存约 1.8GB（2026-10-26 实测），所以两个容器都设了 `mem_limit`：超限时只杀掉这个容器，不会拖累路由和其他服务。

TF 卡写入：SQLite 在 `/opt/conduit/new-api/data`，用量通过 `BATCH_UPDATE_ENABLED` 每 5 秒合并写一次。adapter 默认不写任何文件。

## 端口

| 端口 | 服务 | 监听 |
|---|---|---|
| 3010 | new-api | 所有地址（NewAPI 不支持只绑 127.0.0.1） |
| 3011 | adapter | 仅 127.0.0.1 |
| 3012 | web | 仅 127.0.0.1（经 Caddy 访问；IP 白名单和登录限速信任 `X-Forwarded-For`，不能让外部直连） |

⚠️ R4S 的 WAN 方向放行了全部 IPv6，所以 3010 会以明文 HTTP 暴露在公网 IPv6 上，绕过 Caddy 的 TLS。上线前要决定是否在防火墙加一条只针对 3010 的拒绝规则（改防火墙需要先确认并备份 `/etc/config/firewall`）。

## 部署方式

和 gh-mcp 一样走 GitHub Actions（`.github/workflows/deploy.yml`）：

1. `build`：在 GitHub 的 arm64 runner 上构建 `adapter/` 和 `web/`，推到 `ghcr.io/leonardo-zhu/conduit-adapter`、`ghcr.io/leonardo-zhu/conduit-web`（`latest` 和 commit sha 两个 tag）。
2. `deploy`：在 R4S 的 self-hosted runner（标签 `self-hosted, r4s`）上，把仓库里的 `compose.yaml` 拷到 `/opt/stacks/conduit/`，然后 `docker compose pull && up -d`。

`compose.yaml` 以仓库为准，服务器上的副本每次部署都会被覆盖；`.env` 只在服务器上维护，不进仓库。只改了文档（`*.md`、`docs/`）的提交不会触发部署。

## 首次准备（只做一次）

以下命令都在 R4S 上执行（`ssh istoreos`）。涉及重建 github-runners 和 Caddy 的步骤会中断对应服务，执行前先确认。

1. **先把 GitHub 仓库改名为 `conduit`**。runner 注册时绑定的是仓库地址，GHCR 镜像名也按 `conduit` 写的，所以要先改名再注册。

2. **给本仓库注册 self-hosted runner**。R4S 的 `github-runners` 容器按 `.env` 里的 `REPOS` 列表为每个仓库起一个 runner：
   - 在 `/opt/stacks/github-runners/.env` 的 `REPOS` 末尾加上 `,leonardo-zhu/conduit`
   - 如果 `GH_PAT` 是 fine-grained token，要在 GitHub 上把 `conduit` 加进它的仓库范围（需要 Administration: Read and write），否则拿不到注册 token
   - `cd /opt/stacks/github-runners && docker compose up -d`（改了 env 文件必须用 `up -d` 才会生效；会短暂中断其他仓库的 runner）
   - 在 GitHub 仓库的 Settings → Actions → Runners 里确认出现 `r4s-conduit`，状态为 Idle
   - 每多一个 runner，常驻内存大约多几十 MB（.NET 进程，堆上限 80MB），上线后用 `docker stats` 看一下

3. **准备部署目录**。runner 在容器里以 uid 32772 运行，要能往目录里写 `compose.yaml`、读 `.env`：

   ```bash
   mkdir -p /opt/stacks/conduit /opt/conduit/new-api/data /opt/conduit/new-api/logs
   chgrp 32772 /opt/stacks/conduit && chmod 775 /opt/stacks/conduit
   ```

4. **写 `.env`**：按仓库里 `.env.example` 的说明，在 `/opt/stacks/conduit/.env` 填两个随机密钥，然后：

   ```bash
   chown root:32772 /opt/stacks/conduit/.env && chmod 640 /opt/stacks/conduit/.env
   ```

5. **Caddy**：把 `deploy/Caddyfile.snippet` 追加到 `/opt/stacks/caddy/Caddyfile`，然后 `cd /opt/stacks/caddy && docker compose restart`。`*.r4s.leonardo-zhu.me` 已有通配 AAAA 记录，不需要新增 DNS。

6. **触发第一次部署**：推送到 `master`，或者在 Actions 页面手动运行 `Deploy to Docker`。

7. **立刻**打开 `https://conduit.r4s.leonardo-zhu.me` 完成管理员初始化，设置强密码。在此之前，任何能访问到它的人都可能抢先初始化。

## 自定义首页

NewAPI 默认首页是通用的 API 网关宣传页。这里用 `adapter/home/index.html` 替换它：adapter 在 `/_home/` 托管这个页面，NewAPI 的「首页内容」填 URL 后会以 iframe 嵌入，顶栏的登录、主题、语言切换照常保留。

1. Caddy 要有 `/_home*` 转到 3011 的规则（见 `deploy/Caddyfile.snippet`），改完 `docker compose restart`。已部署的机器需要手动更新一次。
2. 部署后，在后台 **系统设置 → 运营设置 → 首页内容** 填 `https://conduit.r4s.leonardo-zhu.me/_home/`，保存。这个值存在 NewAPI 的数据库里，不在仓库中。
3. 之后改页面只需要改 `adapter/home/index.html` 并推送，不用再动后台。想恢复默认首页，把「首页内容」清空即可。

页面会读取 `/api/status` 显示服务状态和版本，并跟随外层 NewAPI 的明暗主题。

## NewAPI 初始配置

### 渠道（上游）

| 渠道 | 类型 | Base URL | Key |
|---|---|---|---|
| Ark | 先试 NewAPI 自带的火山方舟类型；不行就用 OpenAI 兼容类型 + `http://127.0.0.1:3011/ark` | — | Ark API Key |
| MiniMax | OpenAI 兼容 | `http://127.0.0.1:3011/minimax` | MiniMax API Key |
| Nous | OpenAI 兼容 | `http://127.0.0.1:3011/nous` | Nous API Key |

NewAPI 会请求 `<Base URL>/v1/responses`，adapter 据此转换。渠道的模型列表要手动填，adapter 的 `/v1/models` 返回空列表。

### 模型别名

应用只使用别名（如 `vita-chat`），不直接用上游模型名。在渠道的「模型重定向」里把别名映射到上游真实模型名。更换模型时只改这里，应用不用发版。

### 应用与令牌

见 [apps.md](apps.md)。

## 验证（M0）

用 curl 带一个 Conduit 令牌，对每个渠道各测一遍：

1. 非流式文本对话
2. 流式文本对话：检查最后的 `response.completed` 里 `usage` 不为 0，并且 NewAPI 日志里的用量对得上
3. 流式 function calling
4. 图片输入

```bash
curl https://conduit.r4s.leonardo-zhu.me/v1/responses -H "Authorization: Bearer $CONDUIT_TOKEN" -H 'Content-Type: application/json' -d '{"model":"vita-chat","input":"hi","stream":true}'
```

## 更新与回滚

- adapter 代码或 `compose.yaml` 有改动时，推到 `master` 就会自动部署。
- 升级 NewAPI：改 `compose.yaml` 里 `NEW_API_TAG` 的默认版本号，推送即可。
- 回滚 adapter：在服务器上指定旧的 commit sha，

  ```bash
  ssh istoreos 'cd /opt/stacks/conduit && ADAPTER_TAG=<旧 sha> docker compose up -d adapter'
  ```

  或者在 GitHub 上 revert 后重新推送。

## 启用自建服务（web，并行验证）

`compose.yaml` 里的 `web` 服务放在 profile `web` 里，默认不启动；下面这些做完之前，部署只会更新 new-api 和 adapter。web 和 NewAPI 同时运行、用不同的域名，Vita 继续走 NewAPI，直到验证通过再切换（见 `docs/rewrite-plan.md` 阶段 4、5）。

1. **准备密钥**（在自己电脑上，进入仓库的 `web/` 目录）：

   ```bash
   node scripts/hash-password.mjs   # 生成 ADMIN_PASSWORD_HASH，密码至少 12 位
   openssl rand -base64 32          # SESSION_SECRET
   openssl rand -base64 32          # CONDUIT_MASTER_KEY，丢了的话所有上游密钥都要重填
   ```

2. **在 R4S 上建 env 文件和数据目录**（只在服务器上维护，不进仓库）：

   ```bash
   # /opt/stacks/conduit/web.env，权限 600
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD_HASH=scrypt:...
   SESSION_SECRET=...
   CONDUIT_MASTER_KEY=...
   PASSKEY_ORIGIN=https://conduit-next.r4s.leonardo-zhu.me
   ```

   ```bash
   mkdir -p /opt/conduit/web/data && chown 1000:1000 /opt/conduit/web/data   # 容器里是 node 用户
   echo 'COMPOSE_PROFILES=web' >> /opt/stacks/conduit/.env
   ```

   env 文件里的值不能含 `$`（compose 会当变量展开）。

3. **Caddy**：把 `deploy/Caddyfile.snippet` 里 `conduit-next.r4s…` 那一段加到 `/opt/stacks/caddy/Caddyfile`，先 `validate` 再 `reload`（命令见 R4S 的说明文档）。`*.r4s` 的 DDNS 和证书已经覆盖，不用另加 DNS。

4. **部署**：推到 `master`，或在 GitHub 上手动运行 workflow。之后用 `docker stats --no-stream conduit-web` 记下实际内存。

5. **配置**：打开 `https://conduit-next.r4s.leonardo-zhu.me`，用 web.env 里的账号登录。先在头像菜单里注册 Passkey（可选），再建上游（填真实密钥）、应用和别名。

6. **导入 NewAPI 的令牌**（Vita 不用换令牌）。先预览，确认后加 `--apply`：

   ```bash
   cd /opt/stacks/conduit
   docker compose run --rm --no-deps -v /opt/conduit/new-api/data:/newapi:ro web \
     node scripts/import-newapi.mjs /newapi/one-api.db --map root=vita
   ```

   预览里列出的“应用里还没有的别名”要在后台补上；NewAPI 里有额度上限的令牌导入为不限，需要的话重新设。

7. **验证**：用一个导入的令牌对 `https://conduit-next.r4s.leonardo-zhu.me/v1/responses` 发流式和非流式请求、带 tool call 的请求，在后台的使用日志里核对用量，再和上游控制台对账。

### 切换和回退

- 切换：Caddy 里把 `conduit.r4s…` 的 `reverse_proxy` 从 3010 改到 3012（Vita 的地址不变），`PASSKEY_ORIGIN` 改成 `https://conduit.r4s.leonardo-zhu.me` 并 `docker compose up -d web`。Passkey 绑定域名，切换后要重新注册。
- 回退：把 Caddy 改回 3010 即可，NewAPI 一直在运行。
- 观察一段时间没问题后，再从 `compose.yaml` 删掉 new-api 和 adapter（阶段 5）。
