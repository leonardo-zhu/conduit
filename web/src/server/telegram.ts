/**
 * 新事件推送到 Telegram（可选）：机器人令牌和 chat id 都有才推。
 *
 * 先读 CONDUIT_TELEGRAM_BOT_TOKEN / CONDUIT_TELEGRAM_CHAT_ID；没配时读 TELEGRAM_BOT_TOKEN_DEFAULT /
 * TELEGRAM_CHAT_ID，这是 R4S 上 /opt/stacks/.secrets/global.env 里 OpenClaw 默认机器人用的名字，
 * compose 加载了 global.env，令牌改了只需改那一处。
 *
 * 只推新事件，合并进已有事件的不推，免得一个上游挂掉连发几十条。
 * 发送不等结果、失败只打日志，不影响网关请求。
 * 连不上 api.telegram.org 时，可以用 CONDUIT_TELEGRAM_API 换成反代地址，
 * 或者设 NODE_USE_ENV_PROXY=1 加 HTTPS_PROXY 走代理（Node 24 起支持）。
 */
import type { EventInput } from './events'

const SEND_TIMEOUT_MS = 10_000

function telegramConfig() {
  const token = process.env.CONDUIT_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN_DEFAULT
  const chatId = process.env.CONDUIT_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID
  return token && chatId ? { token, chatId } : null
}

function messageFor(event: EventInput): string {
  const lines = [`${event.level === 'error' ? '🔴' : '🟡'} Conduit：${event.title}`]
  if (event.detail) lines.push(event.detail)
  // PASSKEY_ORIGIN 就是后台地址，生产环境必填
  const origin = process.env.PASSKEY_ORIGIN?.replace(/\/+$/, '')
  if (origin && event.link) lines.push(`${origin}${event.link}`)
  return lines.join('\n')
}

export function pushEventToTelegram(event: EventInput) {
  const config = telegramConfig()
  if (!config) return
  const base = (process.env.CONDUIT_TELEGRAM_API || 'https://api.telegram.org').replace(/\/+$/, '')
  fetch(`${base}/bot${config.token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      text: messageFor(event),
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  })
    .then(async (res) => {
      if (!res.ok) console.warn(`[telegram] 推送失败 ${res.status}：${(await res.text()).slice(0, 200)}`)
    })
    .catch((error) => console.warn(`[telegram] 推送失败：${String(error)}`))
}
