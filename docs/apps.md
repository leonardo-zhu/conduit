# 应用接入约定

Conduit 给多个应用共用，Vita 只是第一个接入方。

## 概念

| 概念 | 说明 |
|---|---|
| 应用 | 一个客户端或服务，如 `vita`、`svc-notes`。有总额度（可按月重置），名下的令牌共享 |
| 令牌 | 一台设备或一个服务实例一个，如 `vita-leonardo-iphone`。可以单独设额度、过期时间、模型白名单、IP 白名单 |
| 别名 | 应用调用的模型名，如 `vita-chat`，在应用里配置指向哪个上游的哪个模型。换模型只改别名，应用不用改 |
| 上游 | 模型服务商的一个账号（密钥）和它的接口地址。OpenAI 兼容地址必填，一定提供 Chat Completions；Responses API 可设为原生支持（直接转发）、网关转换或不提供；Anthropic 兼容地址选填，填了就提供 Anthropic Messages（只直接转发）。后台上游列表显示每个上游可用的接口 |

## 接入一个新应用

1. 后台“应用”里新建应用，标识用小写和连字符，设置总额度。
2. 在应用里加别名，命名为 `<应用>-<用途>`，如 `vita-chat`、`notes-summary`，各自指向上游的模型。
3. 后台“API 密钥”里为每个设备或服务实例创建令牌：
   - 名称：`<应用>-<实例>`，如 `vita-leonardo-iphone`
   - 设置过期时间，不要用永不过期
   - 设置额度上限
   - 模型只能选这个应用的别名
4. 令牌明文只在创建时显示一次，服务端不保存。交给应用后存进 Keychain 或服务端的 secret，不要写进代码仓库。丢了就在令牌菜单里“重新生成”。

## 调用约定

- 地址：`https://conduit.r4s.leonardo-zhu.me` 下的 `/v1/chat/completions`、`/v1/responses`（OpenAI 格式）或 `/v1/messages`（Anthropic 格式），应用自己选；`/v1/models` 列出令牌可用的别名
- `/v1/responses` 要求别名指向的上游提供 Responses API（原生或网关转换），不提供时返回 400 `responses_not_supported`，改用 `/v1/chat/completions`
- `/v1/messages` 要求上游填了 Anthropic 兼容地址，没填时返回 400（Anthropic 格式的错误）。Anthropic 客户端（如 Claude Code）把 `ANTHROPIC_BASE_URL` 设为 `https://conduit.r4s.leonardo-zhu.me`，令牌放在 `ANTHROPIC_API_KEY`（`x-api-key`）或 `ANTHROPIC_AUTH_TOKEN`（Bearer）都行
- `Authorization: Bearer <令牌>`，或 `x-api-key: <令牌>`
- `model` 填别名
- 无状态：不支持 `previous_response_id`，每次请求都要带完整上下文
- 建议带上 `X-Request-Id`，会写进用量记录并在响应头返回，方便和应用自己的日志对上
- OpenAI 入口的错误格式 `{ error: { type, code, message } }`：`authentication_error`（401）、`invalid_request_error`（400）、`insufficient_quota`（429）、`upstream_unavailable`（503）、`upstream_error`（502）、`upstream_timeout`（504）
- `/v1/messages` 的错误按 Anthropic 格式 `{ type: 'error', error: { type, message } }` 返回，状态码相同：额度用尽是 `rate_limit_error`，上游停用是 `overloaded_error`，上游出错是 `api_error`，超时是 `timeout_error`

## 撤销

设备丢失或令牌泄露时，在后台禁用或删除对应令牌即可，其他设备不受影响。要停掉整个应用，就禁用这个应用。
