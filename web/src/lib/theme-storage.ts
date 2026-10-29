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
export const THEME_STORAGE_KEYS = {
  mode: 'newapi:theme:v1:mode',
  preset: 'newapi:theme:v1:preset',
  font: 'newapi:theme:v1:font',
  radius: 'newapi:theme:v1:radius',
  scale: 'newapi:theme:v1:scale',
  contentLayout: 'newapi:theme:v1:content-layout',
} as const

/**
 * Conduit: 去掉了主题设置面板，界面固定用默认样式、跟随系统深浅色。
 * 不再读浏览器里以前存的偏好，否则改过的配色、字体就再也改不回来了
 */
export function readThemePreference<T extends string>(
  _key: string,
  _allowed: ReadonlySet<T>,
  fallback: T
): T {
  return fallback
}

export function writeThemePreference(key: string, value: string | null): void {
  if (typeof window === 'undefined') return

  try {
    if (value === null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, value)
    }
  } catch {
    // Keep theme controls usable when storage is blocked or full.
  }
}
