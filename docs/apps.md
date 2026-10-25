# 应用接入约定

Conduit 给多个应用共用，Vita 只是第一个接入方。NewAPI 本身没有「App」概念，按下面的约定映射。

## 概念映射

| Conduit 概念 | NewAPI 中的实现 |
|---|---|
| App | **一个 NewAPI 用户**，用户名就是 App 名，如 `vita`、`svc-notes`。App 的总预算就是这个用户的额度 |
| Principal（设备、服务实例） | 该用户下的**一个令牌**。可以单独设额度、过期时间、模型白名单、IP 白名单 |
| Model Alias | 渠道里的**模型重定向**，以及令牌的模型白名单 |
| Usage Record | NewAPI 的使用日志，可以按用户（App）、令牌、模型、渠道筛选 |

## 接入一个新应用

1. 在后台新建用户，用户名为 App 名，设置总额度。
2. 确定它要用的别名，命名为 `<app>-<用途>`，如 `vita-chat`、`notes-summary`。在对应渠道的模型重定向里加上这些别名。
3. 在该用户下为每个设备或服务实例创建令牌：
   - 名称：`<app>-<实例>`，如 `vita-leonardo-iphone`
   - 设置过期时间，不要用永不过期
   - 设置额度上限
   - 模型白名单只填这个 App 的别名
4. 令牌明文只在创建时显示一次。交给应用后，应用存进 Keychain 或服务端的 secret，不要写进代码仓库。

## 调用约定

- 地址：`https://conduit.r4s.leonardo-zhu.me/v1/responses`
- `Authorization: Bearer <令牌>`
- `model` 填别名
- 按 `store: false` 处理，不支持 `previous_response_id`。每次请求都要带完整上下文
- 建议带上 `X-Request-Id`，方便和应用自己的日志对上

## 撤销

设备丢失或令牌泄露时，在后台禁用或删除对应令牌即可，其他设备不受影响。要停掉整个 App，就禁用对应的用户。
