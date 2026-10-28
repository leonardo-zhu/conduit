# 自建网关进度记录

最后更新：2026-10-29。方向、需求和阶段划分见 [rewrite-plan.md](rewrite-plan.md)，这里只记做到哪了、下次从哪接着做。

## 当前状态

- 分支：`feat/web-console`（从 `master` 切出），**未推送**。
- 已提交，工作区干净：
  - `2e10d12`：Next.js 管理后台，前端取自 NewAPI 并删减到 Conduit 所需。
  - 其后一个提交：管理员登录、重构计划、本文件、删减工具脚本。

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
- 假数据：`/api/*` 由 `src/mock/` 按 NewAPI 返回格式应答（应用 vita / svc-notes、6 个设备令牌、Ark / MiniMax / Nous 三个上游和别名、7 天用量日志），存在内存里，重启复原。真实接口写成具体路由后优先于假接口匹配。

### 阶段 2 的第一块：管理员登录

- 单账号，不建用户表。`ADMIN_USERNAME`、`ADMIN_PASSWORD_HASH`、`SESSION_SECRET` 来自环境变量；实现在 `web/src/server/auth.ts`。
- 密码哈希格式 `scrypt:N:r:p:salt:hash`，生成：`node web/scripts/hash-password.mjs`。
- 会话是 HMAC 签名的 HttpOnly cookie（7 天），服务端不存会话；换 `SESSION_SECRET` 即全部失效。
- 登录失败按 IP 限速：15 分钟内 5 次。
- 除 `/api/status`、`/api/notice` 外，所有 `/api`（包括假接口）都要求登录。
- 登录页只留账号密码（和隐藏着的 Passkey 按钮）；OAuth、微信、Telegram、人机验证、协议勾选都删了。
- 已验证：未登录 401、密码错误、cookie 篡改、限速锁定、登录后跳回原页面、刷新保持登录、退出回登录页。

## 进行中：Passkey 登录

做到一半，**还没写任何代码**；`@simplewebauthn/server` 也还没装（安装那一步被打断了）。已定的设计：

- 一个管理员可以注册多个 Passkey（iCloud 同步的一个，再加 YubiKey / 安卓等）。
- 注册新 Passkey 前要求再输一次密码，防止被盗的会话偷偷绑定 Passkey。
- 凭据存 SQLite，用 Node 内置的 `node:sqlite`（本机 Node 24 已确认可用，SQLite 3.51）。库文件放 `CONDUIT_DATA_DIR`（默认 `web/.data/`，已被 `.gitignore` 忽略）。这一步顺便验证计划里的存储选型。
- 服务端校验用 `@simplewebauthn/server@14.0.3`。
- challenge 放在用 `SESSION_SECRET` 签名的 flow token 里，服务端不存临时状态。
- RP ID 和 origin：生产从环境变量 `PASSKEY_ORIGIN`（如 `https://conduit.r4s.leonardo-zhu.me`）取，RP ID 用它的主机名；本地开发回退到请求的 origin（`localhost`）。
- 登录用可发现凭据（不需要先填用户名），注册时 `residentKey: 'required'`。

前端现成的部分（`web/src/features/auth/passkey/`、`web/src/lib/passkey.ts`）要求的接口格式：

| 接口 | 请求 | 返回 `data` |
|---|---|---|
| `POST /api/user/passkey/login/begin` | 可选 `{ rp_id }` | `{ flow_token, options: { publicKey: <WebAuthn 选项 JSON> } }` |
| `POST /api/user/passkey/login/finish` | `{ flow_token, credential }` | 和密码登录一样的 auth bundle（`authBundle()`），并设置会话 cookie |
| `POST /api/user/passkey/register/begin` | 计划改为 `{ password }`（原版用 `X-Security-Proof` 头） | 同 login/begin |
| `POST /api/user/passkey/register/finish` | `{ flow_token, credential }`，计划加 `name` | 任意非空 |

`credential` 的格式就是 SimpleWebAuthn 的 `RegistrationResponseJSON` / `AuthenticationResponseJSON`（由 `buildRegistrationResult` / `buildAssertionResult` 生成）。

剩下的步骤：

1. 装 `@simplewebauthn/server`，写 `web/src/server/db.ts`（`node:sqlite`，`passkeys` 表：凭据 ID、公钥、计数器、transports、名称、设备类型、是否同步、创建时间、最近使用）。
2. 写上面 4 个接口，再加 `GET /api/user/passkey`（列表）和 `DELETE /api/user/passkey/:id`。
3. `/api/status` 从假接口改为真实路由，`passkey_login` 在至少注册了一个 Passkey 时为 `true`（登录页据此显示 Passkey 按钮）。
4. 头像菜单加“Passkey”入口，弹窗列出已注册的 Passkey（名称、创建 / 最近使用时间、是否同步），可添加、删除。NewAPI 的 `features/auth/passkey/hooks/use-passkey-management.ts` 是单 Passkey + 二次验证的写法，不沿用，做完后删掉。
5. 删掉已经没有入口的 `/otp` 页面（`web/src/app/(auth)/otp/`、`features/auth/otp`）。
6. 验证：浏览器里的 WebAuthn 会弹系统的 Touch ID，没法自动化。计划在 Node 里写一个软件认证器（P-256 密钥 + `none` 证明）跑通接口，界面流程由你用真实设备点一遍。

## 还没做的

### 前端收尾（阶段 1）

- 错误页的“反馈问题”按钮还指向 NewAPI 的 GitHub Issues。
- 渠道相关代码里还有标签聚合的残留分支（不会触发）。
- “获取模型”“复制渠道”两个弹窗没实际测过。
- 顶栏的搜索、通知、主题定制面板要不要留，没看。
- 深色模式、手机端布局没检查。
- 自定义首页（`adapter/home/index.html`）没迁入，`/` 现在直接跳后台。
- 令牌表单的模型下拉列出所有应用的别名，没按应用过滤（要等后端有别名归属）。
- Base UI 的 `nativeButton` 无障碍警告（NewAPI 原代码就有）。

### 阶段 2 其余部分

- 额度口径还是“待确认”：建议按 token、可选按月重置、不预占（见计划“关键设计”）。
- SQLite 建表，实现应用、令牌（只存哈希）、别名（按应用隔离）、上游（密钥用主密钥加密存库）、用量记录的真实接口，逐个替换假接口。
- 页面按新模型调整：“渠道”改为“上游”，别名从渠道里拆出来。
- NewAPI 令牌导入脚本（NewAPI 存的是明文，导入时只存哈希，`sk-...` 格式不变，Vita 不用换令牌）。

### 阶段 3–5

- 数据面：`/v1/responses`、`/v1/chat/completions`、`/v1/models`；迁入 adapter 的协议转换；流式用量、断开中止、并发扣减。
- 部署：Next.js standalone 的 ARM 镜像、compose、CI 改为构建新服务，实测内存（预算 100–150MB）。
- 并行验证、切换 Vita、下线 NewAPI、更新 `docs/setup.md` 和 `docs/apps.md`。

## 本地开发

```bash
cd web
cp .env.example .env.local   # 管理员账号，密码写在文件注释里
pnpm install
pnpm dev                     # http://localhost:3020
```

- `reference/new-api/`：NewAPI 源码参考副本（已 gitignore，`git clone --depth 1 https://github.com/QuantumNous/new-api.git reference/new-api` 可重建），对照原实现和后端返回格式时看这里（Go 代码在 `controller/`、`model/`）。
- 部署环境说明在 `~/HomeLab/r4s/CLAUDE.md`；Vita 的网关设计文档在 `~/Code/Personal/Vita/docs/architecture/llm-gateway-project.md`。

## 踩过的坑

- **改 `next.config.ts` 或 `.env.local` 后要重启 dev 服务**，否则浏览器可能陷入不停刷新的循环。
- **env 文件里的值不能含 `$`**：Next.js 和 docker compose 都会把 `$xxx` 当变量展开（密码哈希因此改用 `:` 分隔）。
- **TypeScript 是 7.0（Go 原生版），没有 JS API**，需要分析代码的工具只能解析 `tsc` 的输出。
- 假接口改了 `src/mock/data.ts` 后，热更新会重新执行 handler 文件；路由表按“方法 + 路径”覆盖注册，避免命中旧的那份。
- 应用内浏览器窗格在后台时，页面切换动画会停在模糊的中间帧，截图前多等一下或用读取文本代替。

## 删减代码用的工具

- `python3 web/scripts/orphans.py web [--delete]`：从 `src/app` 出发沿 import 遍历，列出（或删掉）没人引用的源文件。删除后再跑一次，直到 0 个。
- `python3 web/scripts/prune_imports.py web`：按 `tsc` 报的“未使用”诊断删掉多余的 import，不重排；不在 import 里的未使用变量会列出来手动处理。
