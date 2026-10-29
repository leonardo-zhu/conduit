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
/**
 * Public surface of the Layout module.
 */

// Core components
export { AppHeader } from './components/app-header'
export { AppSidebar } from './components/app-sidebar'
export { AuthenticatedLayout } from './components/authenticated-layout'
export { Header } from './components/header'
export { Main } from './components/main'
export { PageFooterPortal } from './components/page-footer'
export { NavGroup } from './components/nav-group'
export { SectionPageLayout } from './components/section-page-layout'
export { SidebarViewHeader } from './components/sidebar-view-header'
export { SystemBrand } from './components/system-brand'

// Sidebar view registry
export { resolveSidebarView } from './lib/sidebar-view-registry'

// Type exports (type-only to avoid conflicts with components above)
export type {
  NavCollapsible,
  NavGroup as NavGroupType,
  NavItem,
  NavLink,
  ResolvedSidebarView,
  SidebarData,
  SidebarView,
  SidebarViewParent,
} from './types'
export type { SectionPageLayoutProps } from './components/section-page-layout'
