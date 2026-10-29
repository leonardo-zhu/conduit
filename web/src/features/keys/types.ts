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
import { z } from 'zod'

/**
 * Conduit: 令牌（API 密钥）归属应用，在应用抽屉里管理。没有自己的额度和模型白名单，
 * 能用所属应用的全部别名。
 */
export const apiKeySchema = z.object({
  id: z.number(),
  user_id: z.number(), // 所属应用
  app_name: z.string().optional().default(''),
  name: z.string(),
  key: z.string(), // 首尾各 4 位，明文只在创建和重新生成时返回一次
  status: z.number(), // 1 启用，2 禁用，3 已过期
  used_quota: z.number(),
  expired_time: z.number(), // -1 不过期
  created_time: z.number(),
  accessed_time: z.number(),
  allow_ips: z.string().nullish().default(''),
})

export type ApiKey = z.infer<typeof apiKeySchema>

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface ApiKeyList {
  items: ApiKey[]
  total: number
  page: number
  page_size: number
}

export interface ApiKeyFormData {
  name: string
  expired_time: number
  allow_ips: string
}
