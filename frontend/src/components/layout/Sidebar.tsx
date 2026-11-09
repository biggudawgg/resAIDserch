import { Link, NavLink } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { prefetchRoute } from '../../api/prefetch'
import { useMemberName, useOverview, useWorkspace } from '../../api/hooks'
import { cx } from '../../lib/cx'
import { Avatar } from '../ui/Avatar'
import { PRIMARY_NAV, SYSTEM_NAV, type NavItem } from './nav'
import { Wordmark } from './Wordmark'

const ROLE_TEXT = { lead: 'Lead', researcher: 'Researcher', engineer: 'Engineer', viewer: 'Viewer' }

export function Sidebar() {
  const workspace = useWorkspace()
  const overview = useOverview()
  const queryClient = useQueryClient()
  const nameOf = useMemberName()
  const ws = workspace.data
  const stats = overview.data?.stats
  const me = ws?.members.find((m) => m.id === ws.currentUserId)

  const badgeFor = (item: NavItem) => {
    if (!overview.data || !item.badge) return null
    if (item.badge === 'research') {
      return (
        <span className="nav-badges">
          {stats && stats.running > 0 && <span className="nav-live" title={`${stats.running} running`} aria-label={`${stats.running} running`} />}
          {stats && stats.needsReview > 0 && (
            <span className="nav-count nav-count-warn" aria-label={`${stats.needsReview} need review`}>
              {stats.needsReview}
            </span>
          )}
        </span>
      )
    }
    const count = item.badge === 'beliefs' ? overview.data.review.beliefs.length : overview.data.review.deadEnds.length
    return count > 0 ? (
      <span className="nav-count nav-count-warn" aria-label={`${count} to review`}>
        {count}
      </span>
    ) : null
  }

  const renderItem = (item: NavItem) => (
    <li key={item.to}>
      <NavLink
        to={item.to}
        end={item.end}
        className={({ isActive }) => cx('nav-item', isActive && 'is-active')}
        onPointerEnter={() => prefetchRoute(queryClient, item.to)}
        onFocus={() => prefetchRoute(queryClient, item.to)}
      >
        <item.icon className="nav-icon" aria-hidden />
        <span className="nav-label">{item.label}</span>
        {badgeFor(item)}
      </NavLink>
    </li>
  )


  return (
    <aside className="sidebar" aria-label="Main navigation">
      <Link to="/" className="sidebar-brand" aria-label="resAIDserch home">
        <Wordmark size={21} />
      </Link>

      <nav className="nav" aria-label="Sections">
        <ul className="nav-list">{PRIMARY_NAV.map(renderItem)}</ul>
        <p className="nav-section">Workspace</p>
        <ul className="nav-list">{SYSTEM_NAV.map(renderItem)}</ul>
      </nav>

      <div className="sidebar-foot">
        {me && (
          <div className="user-row">
            <Avatar name={nameOf(me.id)} size="sm" />
            <span className="user-text">
              <span className="user-name">{me.name}</span>
              <span className="user-role">{ROLE_TEXT[me.role]}</span>
            </span>
          </div>
        )}
      </div>
    </aside>
  )
}
