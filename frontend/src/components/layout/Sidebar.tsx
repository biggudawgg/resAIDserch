import { Link, NavLink } from 'react-router-dom'
import { useMemberName, useOverview, useWorkspace } from '../../api/hooks'
import type { ProviderStatus } from '../../api/types'
import { cx } from '../../lib/cx'
import { formatUsd, initials } from '../../lib/format'
import { Avatar } from '../ui/Avatar'
import { MeterBar } from '../ui/Meter'
import { ProviderDot } from '../ui/ProviderChip'
import { Logo } from './Logo'
import { PRIMARY_NAV, SYSTEM_NAV, type NavItem } from './nav'

const STATUS_TEXT: Record<ProviderStatus, string> = {
  connected: 'Connected',
  untested: 'Untested',
  error: 'Failed',
  not_configured: 'Not connected',
}

const ROLE_TEXT = { lead: 'Lead', researcher: 'Researcher', engineer: 'Engineer', viewer: 'Viewer' }

export function Sidebar() {
  const workspace = useWorkspace()
  const overview = useOverview()
  const nameOf = useMemberName()
  const ws = workspace.data
  const stats = overview.data?.stats
  const spend = overview.data?.spend
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
      <NavLink to={item.to} end={item.end} className={({ isActive }) => cx('nav-item', isActive && 'is-active')}>
        <item.icon className="nav-icon" aria-hidden />
        <span className="nav-label">{item.label}</span>
        {badgeFor(item)}
      </NavLink>
    </li>
  )

  const budgetShare = spend && spend.budget > 0 ? spend.monthToDate / spend.budget : 0
  const budgetTone = budgetShare >= 1 ? 'crit' : spend && budgetShare >= spend.alertThreshold ? 'warn' : 'accent'

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <Link to="/" className="sidebar-brand">
        <Logo />
        <span className="brand-text">
          <span className="brand-name">Hindsight</span>
          <span className="brand-sub">Literature scout</span>
        </span>
      </Link>

      <div className="workspace-card">
        <span className="workspace-avatar" aria-hidden>
          {ws ? initials(ws.team.name) : ''}
        </span>
        <span className="workspace-text">
          <span className="workspace-name">{ws?.team.name ?? 'Loading…'}</span>
          <span className="workspace-project">{ws?.team.projectName ?? ''}</span>
        </span>
      </div>

      <nav className="nav" aria-label="Sections">
        <ul className="nav-list">{PRIMARY_NAV.map(renderItem)}</ul>
        <p className="nav-section">Workspace</p>
        <ul className="nav-list">{SYSTEM_NAV.map(renderItem)}</ul>
      </nav>

      <div className="sidebar-foot">
        {spend && (
          <Link to="/providers" className="spend-widget">
            <span className="spend-widget-head">
              <span>This month</span>
              <span className="spend-widget-value">
                {formatUsd(spend.monthToDate)}
                <span className="muted"> of {formatUsd(spend.budget)}</span>
              </span>
            </span>
            <MeterBar value={budgetShare} tone={budgetTone} label="Budget used" size="sm" />
          </Link>
        )}

        {ws && (
          <ul className="provider-status-list" aria-label="AI providers">
            {ws.providers
              .filter((p) => p.id !== 'custom' || p.status !== 'not_configured')
              .map((p) => (
                <li key={p.id}>
                  <ProviderDot provider={p.id} />
                  <span className="provider-status-name">{p.short}</span>
                  <span className={cx('provider-status-text', `is-${p.status}`)}>{STATUS_TEXT[p.status]}</span>
                </li>
              ))}
          </ul>
        )}

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
