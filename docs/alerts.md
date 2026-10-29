# 事件提醒（顶栏铃铛 + Telegram）

网关遇到需要管理员看一眼的情况时，会记一条**事件**。事件显示在后台顶栏的铃铛里，配置了 Telegram 的话还会推送一条消息。

这里只记异常，不记普通日志：每个请求的明细仍然看“使用日志”，铃铛只告诉你哪里出了问题、该去哪看。

## 提醒哪些事

| 类型 | `kind` | 级别 | 触发条件 | 对象 | 点击跳到 |
|---|---|---|---|---|---|
| 上游拒绝密钥 | `upstream_auth` | 错误 | 上游返回 401 / 403（密钥失效、欠费、没有模型权限） | 上游 | 上游页 |
| 上游限流 | `upstream_rate_limit` | 警告 | 上游返回 429 | 上游 | 按这个上游筛选的日志 |
| 上游连续失败 | `upstream_failing` | 错误 | 同一上游连续 3 次 5xx、超时或连不上；成功一次就重新计数 | 上游 | 按这个上游筛选的日志 |
| 额度将尽 | `quota_warning` | 警告 | 应用的用量在这次请求后越过 80% | 应用 | 应用页 |
| 额度用尽 | `quota_exhausted` | 错误 | 用量越过 100%；之后每个被网关拒绝的请求都让次数加 1 | 应用 | 应用页 |
| 错误率突增 | `error_rate` | 警告 | 应用最近 10 分钟至少 10 个请求，其中一半以上是上游类失败 | 应用 | 按这个应用筛选的日志 |

“上游类失败”指状态码是 401、403、429 或 5xx（网关记的 502 连不上、504 超时也算）。下面这些属于调用方自己的问题，**不算异常**：

- 调用方断开（499）
- 参数错误（400、404、413、422）
- 令牌无效（网关直接拒绝，不写日志）

额度类事件只在用量**越过**阈值的那一次请求时记录（比较扣费前后的用量），之后不会每个请求都记一次。按月重置额度后，下次越过阈值会再记。

## 流程

```
调用方请求 /v1/*
   │
   ├─ 鉴权 → 别名解析 → 额度检查 ──(额度用尽)──→ noteQuotaRejected ─┐
   │                                                                 │
   ├─ 转发上游，拿到结果                                              │
   │                                                                 │
   └─ recordUsage：写用量记录、扣额度（一个事务）                      │
         │                                                           │
         └─ checkAfterRequest                                        │
               ├─ checkUpstream        401/403/429/连续失败           │
               ├─ checkQuotaCrossing   越过 80% / 100%                │
               └─ checkErrorRate       只在这次是上游类失败时检查       │
                                                                     │
                     ┌───────────────────────────────────────────────┘
                     ▼
              safeRaiseEvent
               ├─ raiseEvent：合并到已有事件，或者新建一条（同时清理 30 天前的）
               └─ 新建的才 → pushEventToTelegram（不等结果）

后台顶栏铃铛 ── 每分钟 GET /api/events ──→ 列表 + 未读数
     点一条 → POST /api/events/:id/read → 跳到对应页面
     全部已读 → POST /api/events/read_all
```

检测都在网关进程里、请求结束后同步完成，没有后台定时任务。查询走的是已有索引，对请求耗时几乎没有影响。检测或写事件出错只打日志，不影响请求本身。

## 合并规则

同一个上游挂掉时，每个请求都会触发一次检测。如果每次都记一条，列表很快会被刷满。所以：

- 新事件和已有事件的**类型相同、对象相同**，并且已有事件**还没读**、或者**最近一小时内出现过**，就合并进去：次数加 1，更新最近时间、标题和细节。
- 否则新建一条。只有新建时才推送 Telegram，所以同一个问题一小时内最多推一次（标为已读、而且安静了一小时之后再出现，才会再推）。
- 铃铛里显示“N 次 · 几分钟前”，时间取最近一次。
- 30 天前的事件在新建事件时顺手删掉。

例子：一个上游连续挂了 20 个请求，铃铛里只有一条“上游 X 连续 20 次失败 · 18 次”（从第 3 次开始记，之后合并了 17 次），Telegram 只推一条。

## 存储

`events` 表（`web/src/server/db.ts` 的第 4 条迁移）：

| 字段 | 说明 |
|---|---|
| `kind` / `level` | 类型、级别（`warning` / `error`） |
| `subject_type` / `subject_id` / `subject_name` | 对象：`upstream` / `app` / `token`，名称冗余存一份，对象删了也能看懂 |
| `title` / `detail` | 显示用的标题和细节（上游的报错正文截取 500 字以内） |
| `link` | 点击后跳转的后台路径 |
| `count` / `first_at` / `last_at` | 合并的次数、首次和最近时间 |
| `read_at` | 已读时间，0 表示未读 |

“上游连续失败”的计数和错误率检查的节流时间只存在内存里，服务重启后从零开始。

## 接口

都需要登录。

| 接口 | 说明 |
|---|---|
| `GET /api/events` | 最近 50 条和未读总数：`{ items, unread }` |
| `POST /api/events/:id/read` | 标一条为已读 |
| `POST /api/events/read_all` | 全部标为已读 |

## Telegram 推送

复用 OpenClaw 的默认机器人（大螃蟹助理，@leonardo_openclaw_bot），发到 Leonardo's Daily Briefing 频道（`-1003750120699`，机器人是频道管理员，有发帖权限）。多个程序共用一个机器人发消息不会冲突（冲突的只有接收消息的 getUpdates，Conduit 只发不收）。

推送不经过任何大模型，也不经过 OpenClaw：Conduit 直接调 Telegram 的 `sendMessage`。所以就算 OpenClaw 以后接入 Conduit、Conduit 的上游挂了，告警照样能发出来。

**配置读取顺序**（机器人令牌和 chat id 都有才推）：

| 用途 | 先读 | 没有时读 |
|---|---|---|
| 机器人令牌 | `CONDUIT_TELEGRAM_BOT_TOKEN` | `TELEGRAM_BOT_TOKEN_DEFAULT` |
| chat id | `CONDUIT_TELEGRAM_CHAT_ID` | `TELEGRAM_CHAT_ID` |

- **生产（R4S）**：`compose.yaml` 的 `env_file` 先加载 `/opt/stacks/.secrets/global.env`（跟 imap-service 一样），令牌用里面 OpenClaw 默认机器人的 `TELEGRAM_BOT_TOKEN_DEFAULT`，换了只改 `global.env`，再 `docker compose up -d` 让容器重读。`global.env` 的 `TELEGRAM_CHAT_ID` 是私聊，Conduit 的 `.env` 里用 `CONDUIT_TELEGRAM_CHAT_ID=-1003750120699` 覆盖成频道。
- **本地测试**：在 `web/.env.local` 里填 `CONDUIT_TELEGRAM_*` 两项。
- **换别的机器人**：在 Conduit 的 `.env` 里填 `CONDUIT_TELEGRAM_*`，优先级高于 `global.env`。

消息用 Telegram 的 HTML 格式排版：标题是事件类型，下面逐行列出关键信息，上游的原始响应放进代码块（JSON 会缩进，超过 800 字截断），最后是后台链接和 `#conduit` 标签（频道里混着其他内容时可以点标签筛选）。例如：

```
🔴 上游拒绝密钥 · Conduit

上游：Ark Agent Plan
状态码：401
触发请求：vita / vita-chat → doubao-seed-1.6
可能原因：密钥失效、欠费或没有这个模型的权限

上游返回
┌──────────────────────────────
│ { "error": { "code": "AuthenticationError", ... } }
└──────────────────────────────

在后台查看 →
#conduit
```

各类型列出的字段：

| 类型 | 字段 |
|---|---|
| 上游拒绝密钥 / 上游限流 | 上游、状态码、触发请求（应用 / 别名 → 上游模型）、可能原因；附上游返回 |
| 上游连续失败 | 上游、连续失败次数、状态码、触发请求；附最近一次的错误 |
| 额度将尽 / 额度用尽 | 应用、额度、已用（百分比）；用尽时加上影响 |
| 错误率突增 | 应用、最近 10 分钟请求数、上游类失败数（百分比） |

这些字段（代码里的 `fields`、`raw`）只用于推送，不入库；铃铛里显示的仍是事件的标题和细节。

链接的域名取 `PASSKEY_ORIGIN`，没配就不带链接。

万一服务器连不上 `api.telegram.org`，有两种办法：

- 设 `CONDUIT_TELEGRAM_API` 为一个反代地址，替换 `https://api.telegram.org`；
- 设 `NODE_USE_ENV_PROXY=1` 加 `HTTPS_PROXY=...`，让 Node 走代理（Node 24 起支持）。

推送 10 秒超时，失败只在服务日志里打一行 `[telegram] 推送失败`，不会重试。

## 代码位置

| 文件 | 内容 |
|---|---|
| `web/src/server/gateway/alerts.ts` | 检测逻辑和全部阈值（文件开头的常量） |
| `web/src/server/gateway/record.ts` | 记账后调用 `checkAfterRequest` |
| `web/src/server/gateway/context.ts` | 额度检查拒绝时调用 `noteQuotaRejected` |
| `web/src/server/events.ts` | 事件表的读写和合并规则 |
| `web/src/server/telegram.ts` | Telegram 推送 |
| `web/src/server/api/events.ts` | 事件接口 |
| `web/src/hooks/use-notifications.ts` | 前端拉取和标为已读 |
| `web/src/components/notification-popover.tsx` | 铃铛和事件列表 |

## 没做的

- **阈值不能在后台改**。80%、连续 3 次、10 分钟 / 10 个请求 / 一半，都写在 `alerts.ts` 开头，用一段时间再调。
- **上游不会自动停用**。连续失败只提醒，不改路由，要不要停用由你决定。
- **流式中途出错不算失败**。上游已经返回 200、流到一半断掉的请求，日志里有错误信息，但不计入连续失败和错误率。
- **查不到上游账户余额**。上游欠费只能从 401 / 403 / 429 间接看出来。
