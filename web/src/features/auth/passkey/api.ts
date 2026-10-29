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
import { authRequestOptions, authResult } from '@/lib/secure-verification'

import type { ApiResponse, PasskeyItem, PasskeyOptionsPayload } from './types'

// Conduit: 管理员可以注册多个 Passkey。注册前要求再输一次密码（原版用 X-Security-Proof），
// 删除按凭据 ID；列表、注册、删除都不轮换登录态
export async function listPasskeys(): Promise<PasskeyItem[]> {
  return authResult(api.get('/api/user/passkey', authRequestOptions))
}

export function beginPasskeyRegistration(
  password: string,
  signal?: AbortSignal
): Promise<PasskeyOptionsPayload> {
  return authResult(
    api.post(
      '/api/user/passkey/register/begin',
      { password },
      { ...authRequestOptions, signal }
    )
  )
}

export function finishPasskeyRegistration(
  flowToken: string,
  payload: Record<string, unknown>,
  name: string,
  signal?: AbortSignal
): Promise<PasskeyItem> {
  return authResult(
    api.post(
      '/api/user/passkey/register/finish',
      { flow_token: flowToken, credential: payload, name },
      { ...authRequestOptions, signal }
    )
  )
}

export function deletePasskey(id: string): Promise<unknown> {
  return authResult(
    api.delete(
      `/api/user/passkey/${encodeURIComponent(id)}`,
      authRequestOptions
    )
  )
}

export function beginPasskeyLogin(
  rpID?: string,
  signal?: AbortSignal
): Promise<PasskeyOptionsPayload> {
  return authResult(
    api.post<ApiResponse<PasskeyOptionsPayload>>(
      '/api/user/passkey/login/begin',
      rpID ? { rp_id: rpID } : undefined,
      { ...authRequestOptions, signal, skipAuthRefresh: true }
    )
  )
}

export async function finishPasskeyLogin(
  flowToken: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ApiResponse> {
  const res = await api.post<ApiResponse>(
    '/api/user/passkey/login/finish',
    { flow_token: flowToken, credential: payload },
    { skipAuthRefresh: true, signal }
  )
  return res.data
}
