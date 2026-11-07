import { Ban, Cpu, FlaskConical, LayoutDashboard, LibraryBig, Lightbulb, Settings, Users, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  badge?: 'research' | 'beliefs' | 'deadEnds'
}

export const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/research', label: 'Research', icon: FlaskConical, badge: 'research' },
  { to: '/beliefs', label: 'Beliefs', icon: Lightbulb, badge: 'beliefs' },
  { to: '/dead-ends', label: 'Dead ends', icon: Ban, badge: 'deadEnds' },
  { to: '/library', label: 'Library', icon: LibraryBig },
  { to: '/meetings', label: 'Meetings', icon: Users },
]

export const SYSTEM_NAV: NavItem[] = [
  { to: '/providers', label: 'Providers & usage', icon: Cpu },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export const ALL_NAV = [...PRIMARY_NAV, ...SYSTEM_NAV]
