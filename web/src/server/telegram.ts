/**
 * 新事件推送到 Telegram（可选）：配了 CONDUIT_TELEGRAM_BOT_TOKEN 和 CONDUIT_TELEGRAM_CHAT_ID 才推。
 *
 * 只推新事件，合并进已有事件的不推，免得一个上游挂掉连发几十条。
 * 发送不等结果、失败只打日志，不影响网关请求。
 * 连不上 api.telegram.org 时，可以用 CONDUIT_TELEGRAM_API 换成反代地址，
 * 或者设 NODE_USE_ENV_PROXY=1 加 HTTPS_PROXY 走代理（Node 24 起支持）。
 */
import type { EventInput } from './events'

const SEND_TIMEOUT_MS = 10_000

export function telegramConfigured(): boolean {
  return !!(process.env.CONDUIT_TELEGRAM_BOT_TOKEN && process.env.CONDUIT_TELEGRAM_CHAT_ID)
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
  if (!telegramConfigured()) return
  const base = (process.env.CONDUIT_TELEGRAM_API || 'https://api.telegram.org').replace(/\/+$/, '')
  fetch(`${base}/bot${process.env.CONDUIT_TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.CONDUIT_TELEGRAM_CHAT_ID,
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
