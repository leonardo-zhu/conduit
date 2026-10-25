# 部署与初始配置

目标机器：R4S（iStoreOS，aarch64，host 网络，所有 stack 在 `/opt/stacks/<name>/`）。R4S 的通用约束见 `~/HomeLab/r4s/CLAUDE.md`。

## 资源预算

| 服务 | 内存上限 | 说明 |
|---|---|---|
| new-api | 384MB | Go 单进程 + SQLite，实际常驻预计远低于上限，上线后用 `docker stats` 实测 |
| adapter | 128MB | Bun，无依赖 |

R4S 没有 swap，可用内存约 1.8GB（2026-10-26 实测），所以两个容器都设了 `mem_limit`：超限时只杀掉这个容器，不会拖累路由和其他服务。

TF 卡写入：SQLite 在 `/opt/conduit/new-api/data`，用量通过 `BATCH_UPDATE_ENABLED` 每 5 秒合并写一次。adapter 默认不写任何文件。

## 端口

| 端口 | 服务 | 监听 |
|---|---|---|
| 3010 | new-api | 所有地址（NewAPI 不支持只绑 127.0.0.1） |
| 3011 | adapter | 仅 127.0.0.1 |

⚠️ R4S 的 WAN 方向放行了全部 IPv6，所以 3010 会以明文 HTTP 暴露在公网 IPv6 上，绕过 Caddy 的 TLS。上线前要决定是否在防火墙加一条只针对 3010 的拒绝规则（改防火墙需要先确认并备份 `/etc/config/firewall`）。

## 部署方式

和 gh-mcp 一样走 GitHub Actions（`.github/workflows/deploy.yml`）：

1. `build`：在 GitHub 的 arm64 runner 上构建 `adapter/`，推到 `ghcr.io/leonardo-zhu/conduit-adapter`（`latest` 和 commit sha 两个 tag）。
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
