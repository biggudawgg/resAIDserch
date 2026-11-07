import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, ServerCrash } from 'lucide-react'
import { ApiError } from '../../api/client'
import { cx } from '../../lib/cx'
import { Button } from './Button'

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={cx('empty', compact && 'empty-compact')}>
      {icon && (
        <div className="empty-icon" aria-hidden>
          {icon}
        </div>
      )}
      <p className="empty-title">{title}</p>
      {description && <p className="empty-desc">{description}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div className="page">
      <EmptyState
        icon={<ServerCrash />}
        title={notFound ? 'Not found' : "Couldn't load this page"}
        description={notFound ? 'It may have been deleted, or the link is wrong.' : message}
        action={
          notFound ? (
            <Link className="btn btn-secondary btn-md" to="/">
              Back to overview
            </Link>
          ) : (
            onRetry && (
              <Button icon={<RefreshCw />} onClick={onRetry}>
                Try again
              </Button>
            )
          )
        }
      />
    </div>
  )
}

export function Skeleton({ width, height = 14, className, style }: { width?: number | string; height?: number | string; className?: string; style?: CSSProperties }) {
  return <span className={cx('skeleton', className)} style={{ width, height, ...style }} aria-hidden />
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card card-body skeleton-card" aria-busy="true" aria-label="Loading">
      <Skeleton width="40%" height={16} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={`${90 - i * 12}%`} />
      ))}
    </div>
  )
}
