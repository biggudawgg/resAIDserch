import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'crit' | 'info'

export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
  title,
}: {
  tone?: Tone
  icon?: ReactNode
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span className={cx('badge', `badge-${tone}`, className)} title={title}>
      {icon}
      {children}
    </span>
  )
}
