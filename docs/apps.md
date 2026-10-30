# 应用接入约定

Conduit 给多个应用共用。目前接入的是 OpenClaw（2026-10-30），Vita 客户端写好后接入。

## 概念

| 概念 | 说明 |
|---|---|
| 应用 | 一个客户端或服务，如 `vita`、`openclaw`。有名称（界面和日志里显示）和标识（创建后不能改，是密钥名和别名的默认前缀）。额度只设在应用上（可按月重置），名下的密钥共用 |
| API 密钥 | 一台设备或一个服务实例一把，如 `vita-leonardo-iphone`。只有名称、过期时间和 IP 白名单，能用所属应用的全部别名，没有自己的额度 |
| 别名 | 应用调用的模型名，如 `vita-chat`，在应用里配置指向哪个服务商的哪个模型。换模型只改别名，应用不用改。别名是选填的，也可以直接写 `服务商标识/模型名` |
| 服务商 | 模型服务商的一个账号（密钥）和它的接口地址，有唯一的标识（如 `ark-agent-plan`）。OpenAI 兼容地址必填，一定提供 Chat Completions；Responses API 可设为原生支持（直接转发）、网关转换或不提供；Anthropic 兼容地址选填，填了就提供 Anthropic Messages（只直接转发）。后台服务商列表显示每个服务商可用的接口 |

## 接入一个新应用

1. 后台“应用”里新建应用：名称随意，标识用小写和连字符，设置额度。
2. 在应用抽屉里加别名，命名为 `<应用>-<用途>`，如 `vita-chat`、`openclaw-mail`，各自指向服务商的模型（下拉框里只有服务商模型列表里的模型，没有的先去服务商里加）。同一个应用里的不同调用方（如 OpenClaw 的各个 agent）用不同别名，就能单独换模型、分开看用量。
3. 在应用抽屉里为每个设备或服务实例创建 API 密钥：
   - 名称：`<应用>-<实例>`，如 `vita-leonardo-iphone`
   - 设置过期时间；跑在自己服务器上的服务可以用永不过期
   - 调用方 IP 固定时可设 IP 白名单（同一台机器上的服务都显示为那台机器的地址，区分调用方靠密钥，不靠 IP）
4. 密钥明文只在创建时显示一次，服务端不保存。交给应用后存进 Keychain 或服务端的 secret，不要写进代码仓库，也不要贴进聊天。丢了就在密钥菜单里“重新生成”。

## 调用约定

- 地址：`https://conduit.r4s.leonardo-zhu.me` 下的 `/v1/chat/completions`、`/v1/responses`（OpenAI 格式）或 `/v1/messages`（Anthropic 格式），应用自己选；`/v1/models` 列出密钥可用的别名，以及启用服务商的 `标识/模型名`
- `/v1/responses` 要求别名指向的服务商提供 Responses API（原生或网关转换），不提供时返回 400 `responses_not_supported`，改用 `/v1/chat/completions`
- `/v1/messages` 要求服务商填了 Anthropic 兼容地址，没填时返回 400（Anthropic 格式的错误）。Anthropic 客户端（如 Claude Code）把 `ANTHROPIC_BASE_URL` 设为 `https://conduit.r4s.leonardo-zhu.me`，密钥放在 `ANTHROPIC_API_KEY`（`x-api-key`）或 `ANTHROPIC_AUTH_TOKEN`（Bearer）都行
- `Authorization: Bearer <密钥>`，或 `x-api-key: <密钥>`
- `model` 填别名，或 `服务商标识/模型名`（如 `ark-agent-plan/ark-code-latest`，不用配别名，模型名原样转发）。注意：任何密钥都能这样调用任何启用的服务商
- OpenAI SDK 一类的客户端：`baseUrl` 写 `https://conduit.r4s.leonardo-zhu.me/v1`（SDK 自己拼 `/responses`、`/chat/completions`）；Anthropic SDK 写到域名为止（SDK 自己拼 `/v1/messages`）
- 无状态：不支持 `previous_response_id`，每次请求都要带完整上下文
- 建议带上 `X-Request-Id`，会写进用量记录并在响应头返回，方便和应用自己的日志对上
- OpenAI 入口的错误格式 `{ error: { type, code, message } }`：`authentication_error`（401）、`invalid_request_error`（400）、`insufficient_quota`（429）、`upstream_unavailable`（503）、`upstream_error`（502）、`upstream_timeout`（504）
- `/v1/messages` 的错误按 Anthropic 格式 `{ type: 'error', error: { type, message } }` 返回，状态码相同：额度用尽是 `rate_limit_error`，上游停用是 `overloaded_error`，上游出错是 `api_error`，超时是 `timeout_error`

## 撤销

设备丢失或密钥泄露时，在应用抽屉里重新生成、禁用或删除对应密钥即可，其他设备不受影响。要停掉整个应用，就禁用这个应用。
