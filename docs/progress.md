# 自建网关进度记录

最后更新：2026-10-29（顶栏铃铛改为网关事件提醒，部署改动仍未提交）。方向、需求和阶段划分见 [rewrite-plan.md](rewrite-plan.md)，这里只记做到哪了、下次从哪接着做。

## 当前状态（2026-10-29 中断时）

- 分支 `feat/web-console`，**未推送**。阶段 1–3 完成，阶段 4 的镜像 / CI 已做，后来按用户要求改成**直接下线 NewAPI 和 adapter**（不并行验证）。
- **工作区里有未提交的改动**（下线 NewAPI 和 adapter）：`compose.yaml` 只剩 web、`.github/workflows/deploy.yml` 只构建 web、`deploy/Caddyfile.snippet` 指向 3012、根目录 `.env.example`、`README.md`、`docs/apps.md`、`docs/setup.md` 重写、删除 `adapter/` 目录、`web/src/server/gateway/transforms.ts` 注释。用户说“先别做部署”，所以没提交；等用户说要部署再提交。
- 最近一轮修 bug 的提交（`e8892e7`..`34ad2b2`）：令牌抽屉死循环、删除二次验证残留、复制上游去掉重置余额、错误页去掉 NewAPI 反馈按钮、概览余额改为各应用汇总、看板“分流”去掉节点和分组层并把“用户”改称“应用”、日志显示“估算”且中途断开的请求算作消耗、应用页“最后登录”改“最近请求”、顶栏去掉通知和“主页”“控制台”、去掉主题设置面板（跟随系统深浅色）。
- 顶栏铃铛已恢复，改为**网关事件提醒**（`9b7201c`..`76a96e8`）：上游 401/403、429、连续失败，应用 / 令牌额度越过 80% / 100%，错误率突增；新事件可推送 Telegram（`CONDUIT_TELEGRAM_*`）。设计和流程见 [alerts.md](alerts.md)。本地用故意写错的上游验证过四类事件、铃铛列表、点击跳转和已读；“额度将尽 80%”要真实扣费才会触发，没有实测。Telegram 推送复用 OpenClaw 默认机器人：生产由 `compose.yaml` 加载 `/opt/stacks/.secrets/global.env`（`compose.yaml` 和根目录 `.env.example` 的相应改动跟部署改动一起未提交），本地 `web/.env.local` 里复制了一份令牌做测试，2026-10-29 本地触发事件，用户确认私聊收到；之后改发到 Daily Briefing 频道（`-1003750120699`），R4S 的 Conduit `.env` 已加 `CONDUIT_TELEGRAM_CHAT_ID`（备份 `.env.bak-2026-10-29`）。
- 被删的界面功能用户确认都不恢复（2026-10-29）：顶栏“主页”“控制台”、错误页反馈按钮、分流图的节点和分组层、复制上游的“重置余额”、“最后登录”、搜索面板的深浅色切换、主题偏好。顶部导航和没用到的公开页布局代码已删（`66065a7`）。语言切换保留。

### 下次先做

1. 用户说过“还有很多 bug”，让用户直接指出具体问题再修，**不要逐页巡检**。
2. 之后：用户在 R4S 上补齐 `.env`、建数据目录、改 Caddy（见 `docs/setup.md` 工作区里的新版本），提交部署改动、合并 master 部署，再用真实上游验证。

## 已完成

### 阶段 1：管理后台界面（`web/`，Next.js 16 App Router）

- NewAPI 前端（`reference/new-api/web`，AGPL-3.0）拷入并删减。`web/LICENSE`、`web/NOTICE`、原文件版权头、侧边栏署名都要保留；修改记录在 `web/README.md`。
- `src/lib/router.tsx`：TanStack Router → Next.js 的兼容层，原文件只改了 import。
- 保留的页面：登录、概览、数据看板、令牌（`/keys`）、使用日志、渠道（`/channels`）、应用（`/apps`，原“用户”）、错误页。
- 按 Conduit 的模型改过的地方：
  - 令牌：归属应用（新增“应用”列和表单字段），模型白名单必填，默认 90 天过期；去掉分组、CC Switch、批量创建。
  - 使用日志：去掉费用、分组、“仅自己”；日志类型只留消耗 / 错误；“用户”列改名“应用”。
  - 数据看板：图表按 token 计（原来换算成金额）；去掉缓存卡片和“总额度”。
  - 概览：示例请求改为 `/v1/responses`，模型取令牌白名单里的别名。
  - 渠道：新建 / 编辑抽屉重写（5165 行 → 约 400 行），只留名称、类型（OpenAI 兼容 / 自定义 / 火山方舟 / MiniMax）、地址、密钥、别名、别名 → 上游模型映射、测试模型、启用、备注；去掉优先级、权重、余额、分组、标签、多 Key、重试等。
  - 应用：表单只留应用标识、显示名、总额度（token）、备注；去掉角色、分组、密码、二次验证。
- 翻译：只留中文和英文；Conduit 新增文案在 `src/i18n/locales/conduit.{zh,en}.json`，覆盖在 NewAPI 原翻译之上，原翻译文件不改。
- 假数据：阶段 1 时 `/api/*` 全由 `src/mock/` 应答；阶段 2 后只剩分组、权限目录、渠道运维设置几个 NewAPI 占位。

### 阶段 2 的第一块：管理员登录

- 单账号，不建用户表。`ADMIN_USERNAME`、`ADMIN_PASSWORD_HASH`、`SESSION_SECRET` 来自环境变量；实现在 `web/src/server/auth.ts`。
- 密码哈希格式 `scrypt:N:r:p:salt:hash`，生成：`node web/scripts/hash-password.mjs`。
- 会话是 HMAC 签名的 HttpOnly cookie（7 天），服务端不存会话；换 `SESSION_SECRET` 即全部失效。
- 登录失败按 IP 限速：15 分钟内 5 次。
- 除 `/api/status`、`/api/notice` 外，所有 `/api`（包括假接口）都要求登录。
- 登录页只留账号密码（和隐藏着的 Passkey 按钮）；OAuth、微信、Telegram、人机验证、协议勾选都删了。
- 已验证：未登录 401、密码错误、cookie 篡改、限速锁定、登录后跳回原页面、刷新保持登录、退出回登录页。

### 阶段 2 的第二块：Passkey 登录

- 管理员可以注册多个 Passkey；入口在头像菜单 → “Passkey”，弹窗里列出、添加、删除。
- 存储：`web/src/server/db.ts`，Node 内置的 `node:sqlite`，库文件 `CONDUIT_DATA_DIR/conduit.db`（默认 `web/.data/`）。表结构用 `PRAGMA user_version` 迁移，`MIGRATIONS` 只追加。存储选型就此验证可用。
- 服务端：`web/src/server/passkey.ts`，用 `@simplewebauthn/server@14.0.3`。
  - 注册前要再输一次密码（和登录共用 IP 限速），注册流程绑定发起时的会话。
  - challenge 放在签名的 flow token 里（`auth.ts` 的 `signToken` / `verifyToken`，带 `kind`，会话 cookie 和 flow token 不能互相冒用）；用过的 token 记在内存里直到过期（5 分钟），防重放。
  - RP：生产必须设 `PASSKEY_ORIGIN`，RP ID 取它的主机名；开发回退到请求的 origin。**改域名后旧 Passkey 全部失效。**
  - 登录用可发现凭据，注册时 `residentKey: 'required'`、`userVerification: 'required'`。
- 接口：`/api/user/passkey`（GET 列表）、`/api/user/passkey/:id`（DELETE）、`/api/user/passkey/{login,register}/{begin,finish}`。
- `/api/status` 改为真实路由，`passkey_login` 在至少有一个 Passkey 时为 `true`。
- 删掉了 `/otp` 页面和 NewAPI 的单 Passkey 管理 hook。
- 已验证：`node web/scripts/passkey-smoke.mjs`（Node 里的软件认证器）21 项全过，含重放、签名篡改、flow token 串用、删除后登录；界面上看过列表、错误密码提示、删除确认、登录页按钮的显示。
- **待你用真实设备点一遍**：头像菜单 → Passkey → 添加（Touch ID），退出后用“使用 Passkey 登录”。浏览器的 WebAuthn 没法自动化。

### 阶段 2 的第三块：数据库和管理接口

- 表结构（`web/src/server/db.ts` 迁移 2）：`apps`、`upstreams`、`aliases`、`tokens`、`usage_logs`。额度单位都是 token，0 表示不限。
- 额度口径按计划里的建议实现：按 token 计；应用可选每月 1 日重置（读和扣减前惰性清零）；不预占。令牌的额度不分周期。
- 上游密钥：`CONDUIT_MASTER_KEY`（32 字节 base64）做 AES-256-GCM 加密后存库，接口只返回末四位。**换主密钥后要在后台重填所有上游密钥。**
- 令牌：只存 sha256(去掉 sk- 的密钥) 和首尾各 4 位；明文只在创建和重新生成时返回一次。格式和 NewAPI 一样是 48 位字母数字。
- 别名属于应用（`app_id + name` 唯一），在应用抽屉里配置：别名 → 上游 → 上游模型。令牌白名单只能选本应用的别名；令牌还在用的别名不能删；有别名指向的上游不能删。
- 接口：路径和返回格式沿用 NewAPI（`/api/user` = 应用，`/api/channel` = 上游，`/api/token`、`/api/log`、`/api/data`），前端改动最小。新增 `/api/app/:id/aliases`、`/api/token/:id/regenerate`。实现在 `web/src/server/api/`，由 `src/app/api/[...path]` 先查真实接口再查假接口。
- 上游的“测试”和“拉取模型”会真的请求上游（Chat Completions `max_tokens=1` 和 `GET /models`）。
- 前端：上游抽屉只填上游提供的模型；应用抽屉加别名和额度周期；令牌创建 / 重新生成后弹窗显示一次密钥，去掉查看和复制已有密钥；界面上的“渠道”统一叫“上游”（在加载翻译时替换）。
- 脚本（都在 `web/scripts/`）：
  - `api-smoke.mjs`：管理接口 39 项检查，自己建、自己删。
  - `seed-dev.mjs`：本地示例数据（2 个应用、3 个上游、4 个别名、6 个令牌、420 条用量记录），已有 vita 时跳过。
  - `import-newapi.mjs`：从 `one-api.db` 的拷贝导入令牌，默认只预览，`--map 用户名=应用标识`、`--apply`。用假的 NewAPI 库验证过：哈希对得上、软删除跳过、重复运行跳过。
- 已验证：两个冒烟测试全过；浏览器里看过应用（别名编辑、删除被占用别名的提示）、令牌（按应用过滤别名、一次性密钥、重新生成）、上游（模型列表、启停状态）、日志和看板。

### 阶段 3：网关数据面

- 入口：`web/src/app/v1/{responses,chat/completions,models}/route.ts`，逻辑在 `web/src/server/gateway/`。不走后台的会话登录，用 `Authorization: Bearer sk-...` 鉴权。
- 流程：令牌鉴权 → 别名解析（令牌白名单 + 应用的别名）→ 额度检查（不预占）→ 按上游协议改写请求 → 转发 → 读用量 → 一个事务里写用量记录、扣令牌和应用额度。
- 上游协议（`upstreams.protocol`，上游抽屉里选）：
  - `responses`：原生 Responses API（火山方舟），`/v1/responses` 透传，只去掉 `store`、`metadata` 等它不认的字段。
  - `chat`：只支持 Chat Completions，`/v1/responses` 由网关转成 Chat，再把响应（含流式）转回 Responses。
  - `/v1/chat/completions` 两种上游都直接转发到 `/chat/completions`。
- 协议转换迁自 `adapter/lib/transforms.ts`，改了三处：流式事件改用标准名 `response.output_text.delta`（adapter 用的是非标准的 `content_part.delta`）；不再追加 `[DONE]`；上游没给 usage 时 `response.completed` 不带 usage。
- 记账：以上游返回的 usage 为准；拿不到时按字符数估算（约 2 字符 / token）并标“估算”。上游报错不扣额度。调用方中途断开：立即中止上游，按已收到的输出估算，状态码记 499。
- 超时：等响应头 2 分钟；非流式总时长 5 分钟；流式 5 分钟没有任何数据算超时（流里发 `error` 事件后结束）。
- 错误格式：`{ error: { type, code, message } }`。type：`authentication_error`（401，原因只进日志）、`invalid_request_error`（400）、`insufficient_quota`（429）、`upstream_unavailable`（503）、`upstream_error`（502，不透出上游细节）、`upstream_timeout`（504）。
- `X-Request-Id`：调用方给了就沿用（否则生成），写进用量记录并在响应头返回。不支持 `previous_response_id`（400）。
- 已验证（`scripts/gateway-smoke.mjs` + `scripts/mock-upstream.mjs`，44 项）：阶段 3 验证清单的三项都过了——流式用量与上游一致；调用方断开时上游连接立即被中止、只按已收到的输出扣；20 个并发请求扣减正好 20 × 15。另有鉴权、白名单、额度、转换（文本、`<think>`、tool call、tools 格式）和错误格式。
- **没有对真实上游验证过**：火山方舟、MiniMax、Nous 都只用假上游测过。部署前要用真实密钥各跑一遍（流式文本、tool call、图片输入）。

### 阶段 4 的准备：镜像、compose、CI（未部署）

- `web/Dockerfile`：Node 24 Alpine，两阶段构建，只带 standalone 产物、静态文件和 NewAPI 导入脚本，以 node 用户（uid 1000）运行，默认监听 127.0.0.1:3012，数据在 `/data`。
- 构建产物曾经把本地 `.data/conduit.db`、`src`、`scripts` 一起打包（文件追踪看到了 `path.resolve('.data')`），已在 `next.config.ts` 排除，`.dockerignore` 也排除了 `.data` 和 `.env*`。
- `compose.yaml` 的 `web` 服务放在 profile `web` 里：服务器 `.env` 加 `COMPOSE_PROFILES=web` 才会启动，合并到 master 不影响现在的 new-api 和 adapter。`mem_limit: 256m`。
- CI 同时构建 `ghcr.io/leonardo-zhu/conduit-web`。Caddy 片段里并行验证期间用 `conduit-next.r4s.leonardo-zhu.me`。
- 本机 arm64 容器实测：空闲约 57MB，300 个流式请求压测后稳定在约 93MB（macOS 上直接跑 Node 是 110–190MB，以容器的数字为准）。三套冒烟测试在容器里全部通过。
- 启用步骤（web.env、数据目录、Caddy、导入令牌、切换、回退）写在 `docs/setup.md` 的“启用自建服务”。

## 还没做的

### 前端收尾（阶段 1）

- 渠道相关代码里还有标签聚合的残留分支（不会触发）。
- “获取模型”“复制渠道”两个弹窗没实际测过。
- 深色模式、手机端布局没检查。
- 自定义首页（`adapter/home/index.html`）没迁入，`/` 现在直接跳后台。
- Base UI 的 `nativeButton` 无障碍警告（NewAPI 原代码就有）。

### 阶段 2 其余部分

- 接口路径仍是 NewAPI 的（`/api/user`、`/api/channel`），以后要不要改成 `/api/apps`、`/api/upstreams` 再说。

### 阶段 3 的遗留

- 用真实上游验证（见上）；对照上游控制台的用量对账。
- Vita 设计文档里的路由策略（备用上游链、按别名配置超时 / 重试 / 参数覆盖）没做，目前一个别名只指向一个上游。
- 令牌的“最大并发”限制没做；图片输入的体积上限没设。
- 用量记录每个请求写一次库；计划里的“批量写入”（减少 TF 卡写入）等实测后再定。
- adapter 里的自定义首页（`/_home`）没迁过来。

### 阶段 4–5

- 按 `docs/setup.md` 在 R4S 上启用 web（需要你在服务器上建 web.env、数据目录、改 Caddy，并把分支合并到 master），在 R4S 上实测内存。
- 并行验证、切换 Vita、下线 NewAPI、更新 `docs/setup.md` 和 `docs/apps.md`。

## 本地开发

```bash
cd web
cp .env.example .env.local   # 管理员账号（密码写在文件注释里）、会话密钥、主密钥
pnpm install
pnpm dev                     # http://localhost:3020
node scripts/seed-dev.mjs    # 另开终端，写入示例数据
```

- `reference/new-api/`：NewAPI 源码参考副本（已 gitignore，`git clone --depth 1 https://github.com/QuantumNous/new-api.git reference/new-api` 可重建），对照原实现和后端返回格式时看这里（Go 代码在 `controller/`、`model/`）。
- 部署环境说明在 `~/HomeLab/r4s/CLAUDE.md`；Vita 的网关设计文档在 `~/Code/Personal/Vita/docs/architecture/llm-gateway-project.md`。

## 踩过的坑

- **改 `next.config.ts` 或 `.env.local` 后要重启 dev 服务**，否则浏览器可能陷入不停刷新的循环。
- **env 文件里的值不能含 `$`**：Next.js 和 docker compose 都会把 `$xxx` 当变量展开（密码哈希因此改用 `:` 分隔）。
- **TypeScript 是 7.0（Go 原生版），没有 JS API**，需要分析代码的工具只能解析 `tsc` 的输出。
- 假接口改了 `src/mock/data.ts` 后，热更新会重新执行 handler 文件；路由表按“方法 + 路径”覆盖注册，避免命中旧的那份。
- **删掉页面后 `pnpm typecheck` 会报 `.next/types/validator.ts` 找不到模块**：dev 服务不会清理，跑 `pnpm exec next typegen` 重新生成。
- **在 Mac 上跑容器测试时，宿主机读不到容器写的 SQLite**（WAL 的共享内存跨不过 Docker 的虚拟机），测试脚本要放进同一个 Docker 里跑，写法见 `scripts/gateway-smoke.mjs` 的注释。
- **IP 白名单和登录限速按 `X-Forwarded-For` 的第一个地址判断**：只在 Caddy 后面才可信（Caddy 默认会丢掉不可信来源带的 XFF 重新设置）。服务端口不要直接暴露到公网。
- **令牌白名单引用的别名不存在时，令牌在后台编辑会报错**：导入 NewAPI 令牌后先在应用里把别名补齐。
- 改了会话 cookie 的签名格式（加了 `kind`），升级前发出的会话都失效，需要重新登录。
- 应用内浏览器窗格在后台时，页面切换动画会停在模糊的中间帧，截图前多等一下或用读取文本代替。

## 删减代码用的工具

- `python3 web/scripts/orphans.py web [--delete]`：从 `src/app` 出发沿 import 遍历，列出（或删掉）没人引用的源文件。删除后再跑一次，直到 0 个。
- `python3 web/scripts/prune_imports.py web`：按 `tsc` 报的“未使用”诊断删掉多余的 import，不重排；不在 import 里的未使用变量会列出来手动处理。
