# Conduit

自托管的多应用 LLM 网关。所有应用（Vita 是第一个试点，之后的小服务也一样）的模型调用都从这里走：鉴权、额度、渠道路由、模型别名、用量记录、管理后台。

设计文档：Vita 仓库 `docs/architecture/llm-gateway-project.md`。

## 架构

```
应用 / 服务 ──Responses API + Conduit 令牌──▶ Caddy (conduit.r4s.leonardo-zhu.me)
                                                │
                                                ▼
                                  NewAPI :3010（官方镜像，不改源码）
                                  令牌 · 额度 · 模型重定向 · 渠道 · 日志 · 后台
                                    │                         │
                         原生 Responses 的上游          只支持 Chat 的上游
                                    │                         │
                                    ▼                         ▼
                                  Ark              adapter :3011（本仓库，Bun）
                                                   Responses ↔ Chat 转换
                                                              │
                                                              ▼
                                                     MiniMax / Nous
```

- **NewAPI** 负责网关的全部通用能力。直接用官方镜像，配置都在后台里做。
- **adapter** 只做一件事：把 Responses 请求转成 Chat 发给上游，再把响应（含流式）转回 Responses。它在 NewAPI 里配成一个「OpenAI 兼容」渠道，自己不保存任何 Key，上游 Key 由 NewAPI 通过 `Authorization` 头透传过来。

## 目录

```
compose.yaml          NewAPI + adapter，部署时由 CI 拷到 R4S 的 /opt/stacks/conduit/
.github/workflows/    构建 adapter 镜像推 GHCR，再由 R4S 的 self-hosted runner 部署
.env.example          部署所需的密钥模板（复制为 .env）
deploy/
  Caddyfile.snippet   追加到 R4S 的 Caddyfile
adapter/              协议转换层
  Dockerfile          镜像：ghcr.io/leonardo-zhu/conduit-adapter
  index.ts            入口，注册路由
  lib/server.ts       HTTP 服务：鉴权头透传、按路径决定是否转换
  lib/transforms.ts   Responses ↔ Chat 转换（请求、响应、SSE 流）
  proxies/            每个上游一个路由：ark / minimax / nous
  CONVERSION.md       转换设计说明
docs/
  setup.md            部署与 NewAPI 初始配置
  apps.md             新应用接入约定
```

## 本地运行 adapter

```bash
PORT=3011 bun run adapter/index.ts
```

```bash
curl http://127.0.0.1:3011/health
```

adapter 不读任何上游 Key，调用时自己带上：

```bash
curl http://127.0.0.1:3011/minimax/v1/responses -H "Authorization: Bearer $MINIMAX_API_KEY" -H 'Content-Type: application/json' -d '{"model":"<上游模型名>","input":"hi","stream":true}'
```

调试时设 `ADAPTER_DEBUG_LOG=1`，完整请求和响应会写进 `logs/adapter-debug.log`。默认关闭，因为请求体可能含用户内容。

## adapter 路由

| 路径前缀 | 上游 | 行为 |
|------|------|------|
| `/ark` | 火山方舟 | Responses 请求：剥掉不兼容字段、补全 input item 的 `status` 后透传；其他请求原样透传 |
| `/minimax` | MiniMax | Responses ↔ Chat 双向转换，`<think>` 标签拆成 reasoning |
| `/nous` | NousResearch | Responses ↔ Chat 双向转换 |

只有路径以 `/responses` 结尾的请求会做转换。`/v1/chat/completions` 之类的请求原样转发，方便 NewAPI 的「测试渠道」功能。

## 部署

见 [docs/setup.md](docs/setup.md)。
