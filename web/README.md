# Conduit Web

Conduit 的管理后台，Next.js 16（App Router）。

## 来源与许可

前端代码大部分取自 [NewAPI](https://github.com/QuantumNous/new-api) 的 `web/`（提交 `e449cc7`，2026-10-28），按 AGPL-3.0 使用，本目录随之以 AGPL-3.0-or-later 发布，见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。原文件保留版权头；按 NOTICE 的附加条款，界面上保留了署名和原项目链接（头像菜单 → 关于，`src/components/about-dialog.tsx`），不要删。

相对原版的修改（AGPLv3 第 7(c) 条要求标明）：

- 构建从 rsbuild + TanStack Router 换成 Next.js App Router。路由入口在 `src/app/`，`src/lib/router.tsx` 是 TanStack Router API 的兼容层，原文件只改了 import。
- 入口 `main.tsx` 和 `routes/__root.tsx` 合并成 `src/app/app-shell.tsx`，去掉了 setup 引导、旧路由跳转和推广码。
- 只保留：登录（账号密码；Passkey 的前端流程保留，后端待接）、仪表盘、令牌、用量日志、渠道、用户、错误页。删掉了聊天、Playground、钱包、充值、兑换码、订阅、定价、模型广场、排行榜、模型管理、系统设置、任务插件、个人资料、安全设置、注册和找回密码等。
- 用量日志去掉了单价、阶梯计费、订阅扣费来源、请求策略记录和审计日志；仪表盘去掉了性能指标面板。
- 界面语言只保留简体中文和英文。
- 顶栏铃铛从系统通知和公告改为网关事件（上游异常、额度告急、错误率突增），已读状态存在服务端。
- logo 和浏览器图标换成 Conduit 自己的（`public/logo.svg`、`public/icon.svg`，PNG 和 ico 由它们渲染），不再使用 NewAPI 的图形。

## 本地开发

```bash
cp .env.example .env.local   # 本地开发用的管理员账号，密码写在文件注释里
pnpm install
pnpm dev        # http://localhost:3020
```

管理员登录只有一个账号，来自环境变量（`ADMIN_USERNAME`、`ADMIN_PASSWORD_HASH`、`SESSION_SECRET`），实现在 `src/server/auth.ts`。生产环境的密码哈希用 `node scripts/hash-password.mjs` 生成。除 `/api/status`、`/api/notice` 外，所有 `/api` 都要求登录。

自己的后端还没写，`/api/*` 由假数据接口应答（`src/mock/`，入口 `src/app/api/[...path]/route.ts`），返回格式照 NewAPI。

- `src/mock/data.ts`：假数据，按 Conduit 的场景编（应用 vita / svc-notes、设备令牌、Ark / MiniMax / Nous 三个上游和别名、最近 7 天的用量日志），存在内存里，重启 dev 服务后复原。
- `src/mock/handlers/`：按领域分文件的假接口。页面请求了没实现的接口时，终端会打出 `[mock] 未实现 ...`。
- 真实接口写成具体路由（如 `src/app/api/token/route.ts`）后会优先于假接口匹配，写一个删一个对应的假接口。

`reference/new-api/` 是 NewAPI 源码的参考副本（已 gitignore），要对照原实现时看那里。
