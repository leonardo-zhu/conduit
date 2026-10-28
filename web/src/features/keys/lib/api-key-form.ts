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
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'

import type { ApiKey, ApiKeyFormData } from '../types'

// Conduit: 令牌归属一个应用，必须限定可用的别名、设置过期时间；
// 去掉了 NewAPI 的分组、自动分组、跨组重试、额度查询和批量创建

// ============================================================================
// Form Schema
// ============================================================================

export function getApiKeyFormSchema(t: TFunction) {
  return z
    .object({
      user_id: z.number({ error: t('Please select an app') }).int().positive(),
      name: z.string().min(1, t('Please enter a name')),
      remain_quota_dollars: z.number().optional(),
      expired_time: z.date().nullable(),
      unlimited_quota: z.boolean(),
      model_limits: z.array(z.string()).min(1, t('Select at least one model')),
      allow_ips: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.unlimited_quota) return
      if (
        data.remain_quota_dollars === undefined ||
        data.remain_quota_dollars < 0
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['remain_quota_dollars'],
          message: t('Quota must be zero or greater'),
        })
      }
    })
}

export type ApiKeyFormValues = z.infer<ReturnType<typeof getApiKeyFormSchema>>

// ============================================================================
// Form Defaults
// ============================================================================

/** 新令牌默认 90 天后过期（约定：不要用永不过期） */
const DEFAULT_EXPIRY_DAYS = 90

export function getApiKeyFormDefaultValues(): ApiKeyFormValues {
  return {
    user_id: undefined as unknown as number,
    name: '',
    remain_quota_dollars: 0,
    expired_time: new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 86400 * 1000),
    unlimited_quota: false,
    model_limits: [],
    allow_ips: '',
  }
}

// ============================================================================
// Form Data Transformation
// ============================================================================

/**
 * Transform form data to API payload
 */
export function transformFormDataToPayload(
  data: ApiKeyFormValues
): ApiKeyFormData {
  return {
    user_id: data.user_id,
    name: data.name,
    remain_quota: data.unlimited_quota
      ? 0
      : parseQuotaFromDollars(data.remain_quota_dollars || 0),
    expired_time: data.expired_time
      ? Math.floor(data.expired_time.getTime() / 1000)
      : -1,
    unlimited_quota: data.unlimited_quota,
    model_limits_enabled: true,
    model_limits: data.model_limits.join(','),
    allow_ips: data.allow_ips || '',
  }
}

/**
 * Transform API key data to form defaults
 */
export function transformApiKeyToFormDefaults(apiKey: ApiKey): ApiKeyFormValues {
  return {
    user_id: apiKey.user_id ?? (undefined as unknown as number),
    name: apiKey.name,
    remain_quota_dollars: apiKey.unlimited_quota
      ? 0
      : quotaUnitsToDollars(apiKey.remain_quota),
    expired_time:
      apiKey.expired_time > 0 ? new Date(apiKey.expired_time * 1000) : null,
    unlimited_quota: apiKey.unlimited_quota,
    model_limits: apiKey.model_limits
      ? apiKey.model_limits.split(',').filter(Boolean)
      : [],
    allow_ips: apiKey.allow_ips || '',
  }
}
