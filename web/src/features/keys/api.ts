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
import { api } from '@/lib/api'

import type { ApiKey, ApiKeyFormData, ApiKeyList, ApiResponse } from './types'

export async function getApiKeys(
  params: { appId?: number; p?: number; size?: number } = {}
): Promise<ApiResponse<ApiKeyList>> {
  const { appId, p = 1, size = 100 } = params
  const query = new URLSearchParams({ p: String(p), size: String(size) })
  if (appId) query.set('app_id', String(appId))
  const res = await api.get(`/api/token/?${query.toString()}`)
  return res.data
}

// 创建：返回的 key 是明文（不带 sk-），只这一次
export async function createApiKey(
  data: ApiKeyFormData & { user_id: number }
): Promise<ApiResponse<ApiKey & { key: string }>> {
  const res = await api.post('/api/token/', data)
  return res.data
}

export async function updateApiKey(
  data: ApiKeyFormData & { id: number }
): Promise<ApiResponse<ApiKey>> {
  const res = await api.put('/api/token/', data)
  return res.data
}

export async function updateApiKeyStatus(
  id: number,
  status: number
): Promise<ApiResponse<ApiKey>> {
  const res = await api.put('/api/token/?status_only=true', { id, status })
  return res.data
}

// 服务端只存哈希，查不到明文。重新生成后旧密钥立即失效，新明文只返回这一次
export async function regenerateApiKey(
  id: number
): Promise<ApiResponse<ApiKey & { key: string }>> {
  const res = await api.post(`/api/token/${id}/regenerate`)
  return res.data
}

export async function deleteApiKey(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/token/${id}/`)
  return res.data
}
