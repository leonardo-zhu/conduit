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
import { LanguageSwitcher } from '@/components/language-switcher'
import { NotificationPopover } from '@/components/notification-popover'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { useNotifications } from '@/hooks/use-notifications'

import { Header } from './header'
import { SystemBrand } from './system-brand'

/**
 * General application Header component
 * Integrates search, gateway alerts, language and profile functions
 *
 * @example
 * // Basic usage
 * <AppHeader />
 *
 * @example
 * // Hide search box
 * <AppHeader showSearch={false} />
 *
 * @example
 * // Fully customize left and right content
 * <AppHeader
 *   leftContent={<CustomLeft />}
 *   rightContent={<CustomRight />}
 * />
 */
type AppHeaderProps = {
  /**
   * Left content, shown after the brand
   */
  leftContent?: React.ReactNode
  /**
   * Whether to show search box
   * @default true
   */
  showSearch?: boolean
  /**
   * Custom right content, overrides default right content if provided
   */
  rightContent?: React.ReactNode
  /**
   * Whether to show the gateway alerts bell
   * @default true
   */
  showNotifications?: boolean
  /**
   * Whether to show profile dropdown
   * @default true
   */
  showProfileDropdown?: boolean
}

export function AppHeader({
  // Conduit: 纯管理后台，去掉了顶部的“主页”“控制台”导航（都进后台首页）和主题设置（跟随系统）；
  // 铃铛改为网关事件（上游异常、额度告急、错误率突增）
  leftContent,
  showSearch = true,
  rightContent,
  showNotifications = true,
  showProfileDropdown = true,
}: AppHeaderProps) {
  const notifications = useNotifications()

  return (
    <Header>
      <div className='@container/system-brand flex min-w-0 flex-1 items-center gap-1'>
        <SystemBrand variant='inline' />
      </div>

      {leftContent ? (
        <div className='ms-2 flex items-center'>{leftContent}</div>
      ) : null}

      {rightContent ?? (
        <div className='ms-auto flex shrink-0 items-center gap-1 sm:gap-2'>
          {showSearch && (
            <Search className='w-8 flex-none [&>span]:hidden sm:[&>span]:inline' />
          )}
          {showNotifications && (
            <NotificationPopover
              open={notifications.popoverOpen}
              onOpenChange={notifications.setPopoverOpen}
              unreadCount={notifications.unreadCount}
              events={notifications.events}
              loading={notifications.loading}
              onMarkRead={notifications.markRead}
              onMarkAllRead={notifications.markAllRead}
            />
          )}
          <LanguageSwitcher />
          {showProfileDropdown && <ProfileDropdown />}
        </div>
      )}
    </Header>
  )
}
