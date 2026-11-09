import { useMemo } from 'react'
import { useUsage } from '../../api/hooks'
import { formatUsd } from '../../lib/format'
import { EmptyState } from '../ui/States'
import { SpendingRing, type SpendingCategory } from './SpendingRing'

const DAYS = 30
const MAX_SLICES = 6
const COLORS = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)', 'var(--cat-5)', 'var(--cat-6)']

/** Percent change from the previous window, or undefined when there was nothing to compare against. */
function changeFrom(previous: number, current: number): number | undefined {
  return previous > 0 ? ((current - previous) / previous) * 100 : undefined
}

/** Spend by task over the last 30 days, as a spending ring. The previous 30 days come from the 60-day window minus the last 30. */
export function SpendByTask() {
  const recent = useUsage(DAYS)
  const wide = useUsage(DAYS * 2)

  const view = useMemo(() => {
    if (!recent.data) return null
    const previousByTask = new Map<string, number>()
    for (const t of wide.data?.byTask ?? []) previousByTask.set(t.task, t.costUsd)
    for (const t of recent.data.byTask) previousByTask.set(t.task, (previousByTask.get(t.task) ?? 0) - t.costUsd)

    const paid = recent.data.byTask.filter((t) => t.costUsd > 0).sort((a, b) => b.costUsd - a.costUsd)
    const free = recent.data.byTask.filter((t) => t.costUsd === 0 && t.calls > 0).map((t) => t.label)
    const comparable = Boolean(wide.data)

    const head = paid.length > MAX_SLICES ? paid.slice(0, MAX_SLICES - 1) : paid
    const tail = paid.length > MAX_SLICES ? paid.slice(MAX_SLICES - 1) : []
    const categories: SpendingCategory[] = head.map((t, i) => ({
      name: t.label,
      amount: t.costUsd,
      color: COLORS[i],
      change: comparable ? changeFrom(Math.max(0, previousByTask.get(t.task) ?? 0), t.costUsd) : undefined,
    }))
    if (tail.length) {
      const amount = tail.reduce((sum, t) => sum + t.costUsd, 0)
      const previous = tail.reduce((sum, t) => sum + Math.max(0, previousByTask.get(t.task) ?? 0), 0)
      categories.push({ name: 'Other', amount, color: 'var(--cat-other)', change: comparable ? changeFrom(previous, amount) : undefined })
    }
    return { categories, free, total: recent.data.totals.costUsd }
  }, [recent.data, wide.data])

  if (!view) return <div className="skeleton sring-skeleton" aria-busy="true" aria-label="Loading spend" />
  if (view.categories.length === 0) {
    return <EmptyState compact title="No spend in the last 30 days" description="Paid model calls will show up here, split by task." />
  }
  return (
    <div className="stack-sm">
      <div className="sring-total">
        <span>Total</span>
        <strong>{formatUsd(view.total)}</strong>
      </div>
      <SpendingRing categories={view.categories} changeLabel="vs previous 30 days" />
      {view.free.length > 0 && <p className="sring-note">No cost: {view.free.join(', ')}.</p>}
    </div>
  )
}
