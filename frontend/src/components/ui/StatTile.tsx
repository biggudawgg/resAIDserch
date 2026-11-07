import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { MeterBar } from './Meter'

export function StatTile({
  label,
  value,
  sub,
  icon,
  to,
  meter,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  to?: string
  meter?: { value: number; tone: 'accent' | 'warn' | 'crit'; label: string }
}) {
  const body = (
    <>
      <div className="stat-head">
        <span className="stat-label">{label}</span>
        {icon && (
          <span className="stat-icon" aria-hidden>
            {icon}
          </span>
        )}
      </div>
      <div className="stat-value">{value}</div>
      {meter && <MeterBar value={meter.value} tone={meter.tone} label={meter.label} size="sm" />}
      {sub && <div className="stat-sub">{sub}</div>}
    </>
  )
  return to ? (
    <Link to={to} className="stat-tile is-link">
      {body}
    </Link>
  ) : (
    <div className="stat-tile">{body}</div>
  )
}
