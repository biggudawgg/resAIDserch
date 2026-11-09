import { useMemo } from 'react'
import { useTaskHistory, useUsage } from '../../api/hooks'
import type { ProviderId } from '../../api/types'
import { providerLabel } from '../../lib/providers'
import { MetricCard, type MetricEvent, type MetricPoint, type MetricSegment } from './MetricCard'

const PROVIDERS: ProviderId[] = ['claude', 'openai', 'groq']
const DAYS = 28 // twice the longest period, so 14 days always has a previous 14 to compare with

const money = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)

/** Spend per day split by provider, with failovers from the call log pinned on the chart. */
export function SpendTrend() {
  const usage = useUsage(DAYS)
  const history = useTaskHistory()

  const view = useMemo(() => {
    if (!usage.data) return null
    const segments: MetricSegment[] = PROVIDERS.map((p) => ({ name: providerLabel(p), color: `var(--series-${p})` }))
    const data: MetricPoint[] = usage.data.daily.map((d) => ({ date: d.date, parts: PROVIDERS.map((p) => d.byProvider[p] ?? 0) }))
    // One note per day where a call failed over, named after what happened.
    const byDay = new Map<string, MetricEvent>()
    for (const t of history.data ?? []) {
      if (!t.fallbackFrom || !t.routedTo) continue
      const date = t.at.slice(0, 10)
      if (!byDay.has(date)) byDay.set(date, { date, label: `${providerLabel(t.fallbackFrom)} failed over to ${providerLabel(t.routedTo)}` })
    }
    return { segments, data, events: [...byDay.values()] }
  }, [usage.data, history.data])

  if (!view) return <div className="skeleton mcard-skeleton" aria-busy="true" aria-label="Loading spend" />
  return <MetricCard data={view.data} events={view.events} format={money} label="Spend" riseIsGood={false} segments={view.segments} />
}
