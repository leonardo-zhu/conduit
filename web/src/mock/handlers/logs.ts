import { logs, type MockLog } from '../data'
import { mock, ok, paginate, type MockRequest } from '../router'

// 按 NewAPI /api/log 的查询参数过滤
function filterLogs({ query }: MockRequest): MockLog[] {
  const num = (k: string) => (query.get(k) ? Number(query.get(k)) : undefined)
  const str = (k: string) => query.get(k) || undefined
  const start = num('start_timestamp')
  const end = num('end_timestamp')
  const type = num('type')
  const channel = num('channel')
  const username = str('username')
  const tokenName = str('token_name')
  const modelName = str('model_name')
  const requestId = str('request_id')

  return logs.filter(
    (l) =>
      (start === undefined || l.created_at >= start) &&
      (end === undefined || l.created_at <= end) &&
      (!type || l.type === type) &&
      (!channel || l.channel === channel) &&
      (!username || l.username === username) &&
      (!tokenName || l.token_name === tokenName) &&
      (!modelName || l.model_name.includes(modelName)) &&
      (!requestId || l.request_id === requestId)
  )
}

mock('GET', '/api/log', (req) => paginate(filterLogs(req), req.query))

mock('GET', '/api/log/stat', (req) => {
  const list = filterLogs(req)
  const quota = list.reduce((sum, l) => sum + l.quota, 0)
  // 最近 60 秒的请求数和 token 数
  const since = Math.floor(Date.now() / 1000) - 60
  const recent = list.filter((l) => l.created_at >= since)
  return ok({
    quota,
    rpm: recent.length,
    tpm: recent.reduce((sum, l) => sum + l.prompt_tokens + l.completion_tokens, 0),
  })
})
