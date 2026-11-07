import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cx } from '../../lib/cx'

export function Card({
  title,
  description,
  actions,
  children,
  className,
  flush = false,
  id,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  flush?: boolean
  id?: string
}) {
  return (
    <section className={cx('card', className)} id={id}>
      {(title || actions) && (
        <header className="card-header">
          <div className="card-heading">
            {title && <h2 className="card-title">{title}</h2>}
            {description && <p className="card-desc">{description}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={cx(!flush && 'card-body')}>{children}</div>
    </section>
  )
}

const CALLOUT_ICON = { info: Info, warn: AlertTriangle, crit: XCircle, good: CheckCircle2 }

export function Callout({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'warn' | 'crit' | 'good'
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  const Icon = CALLOUT_ICON[tone]
  return (
    <div className={cx('callout', `callout-${tone}`)} role={tone === 'crit' ? 'alert' : undefined}>
      <Icon className="callout-icon" aria-hidden />
      <div className="callout-body">
        {title && <p className="callout-title">{title}</p>}
        {children && <div className="callout-text">{children}</div>}
      </div>
      {action && <div className="callout-action">{action}</div>}
    </div>
  )
}
