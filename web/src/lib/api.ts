/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { api } from '@/lib/http-client'
import { authRequestOptions, authResult } from '@/lib/secure-verification'
import { requireServerSuccess } from '@/lib/server-error-message'

export {
  applyAuthBundle,
  applyAuthRotation,
  bootstrapAuthentication,
  clearAuthenticatedClientState,
  clearAuthentication,
  getCommonHeaders,
  getFreshAuthHeaders,
  isAuthBundle,
  refreshAuthentication,
  resolveAuthentication,
  AuthRotationError,
} from '@/lib/auth-session'
export type { AuthTokenRotation, RefreshOutcome } from '@/lib/auth-session'
export { api }
export type { ApiRequestConfig } from '@/lib/http-client'

// ============================================================================
// User APIs
// ============================================================================

export async function getSelf() {
  const res = await api.get('/api/user/self', {
    skipErrorHandler: true,
  })
  return res.data
}

// Conduit: 传 appId 时只返回该应用的别名
export async function getUserModels(appId?: number): Promise<{
  success: boolean
  message?: string
  data?: string[]
}> {
  const res = await api.get('/api/user/models', {
    params: appId ? { app_id: appId } : undefined,
  })
  return res.data
}

export async function getUserGroups(): Promise<{
  success: boolean
  message?: string
  data?: Record<string, { desc: string; ratio: number | string }>
}> {
  const res = await api.get('/api/user/self/groups')
  return res.data
}

// ============================================================================
// System APIs
// ============================================================================

export async function getStatus() {
  const res = await api.get('/api/status')
  return requireServerSuccess(res.data)?.data as Record<string, unknown>
}

// Conduit: 顶栏铃铛的网关事件（上游异常、额度告急、错误率突增），替代 NewAPI 的系统公告
export interface GatewayEvent {
  id: number
  kind: string
  level: 'warning' | 'error'
  subject_type: 'upstream' | 'app' | 'token'
  subject_id: number
  subject_name: string
  title: string
  detail: string
  link: string
  count: number
  first_at: number
  last_at: number
  read_at: number
}

export async function getEvents() {
  const res = await api.get('/api/events')
  return requireServerSuccess(res.data)?.data as {
    items: GatewayEvent[]
    unread: number
  }
}

export async function markEventRead(id: number) {
  const res = await api.post(`/api/events/${id}/read`)
  return requireServerSuccess(res.data)
}

export async function markAllEventsRead() {
  const res = await api.post('/api/events/read_all')
  return requireServerSuccess(res.data)
}

// Conduit: 配置变更记录（后台对应用、别名、密钥、服务商、Passkey 的增删改）
export interface FieldChange {
  label: string
  from?: string
  to?: string
  /** from / to 是 unix 秒，-1 表示永不 */
  time?: true
}

export interface ConfigChange {
  id: number
  at: number
  actor: string
  ip: string
  subject_type: 'app' | 'alias' | 'token' | 'upstream' | 'passkey'
  subject_id: string
  subject_name: string
  action:
    | 'create'
    | 'update'
    | 'delete'
    | 'enable'
    | 'disable'
    | 'regenerate_key'
    | 'copy'
  changes: FieldChange[]
}

export async function getConfigChanges(params: {
  p: number
  page_size: number
  subject_type?: string
  keyword?: string
}) {
  const res = await api.get('/api/changes', { params })
  return requireServerSuccess(res.data)?.data as {
    items: ConfigChange[]
    total: number
  }
}

// ============================================================================
// 2FA Management APIs
// ============================================================================

export function disable2FA(
  proofToken: string,
  signal?: AbortSignal
): Promise<{ notification_warning?: boolean }> {
  return authResult(
    api.post(
      '/api/user/2fa/disable',
      {},
      {
        ...authRequestOptions,
        headers: { 'X-Security-Proof': proofToken },
        acceptAuthRotation: true,
        singleUseAuthorization: true,
        signal,
      }
    )
  )
}

export function regenerate2FABackupCodes(
  proofToken: string,
  signal?: AbortSignal
): Promise<{ backup_codes: string[]; notification_warning?: boolean }> {
  return authResult(
    api.post(
      '/api/user/2fa/backup_codes',
      {},
      {
        ...authRequestOptions,
        headers: { 'X-Security-Proof': proofToken },
        acceptAuthRotation: true,
        singleUseAuthorization: true,
        signal,
      }
    )
  )
}
