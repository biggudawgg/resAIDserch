import { useMemo } from 'react'
import { useProviders, useTaskHistory } from '../../api/hooks'
import type { ProviderId, TaskLog } from '../../api/types'
import { providerLabel } from '../../lib/providers'
import { UptimeCard, type Incident, type UptimeService } from './UptimeCard'

const DAYS = 30

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * Daily health per provider from the call log. A call that fell back counts as a failure for the provider it fell back
 * from and a success for the one that answered. Days with errors and successes are degraded; days where every call
 * failed are an outage; days with no calls are shown as such.
 */
export function ProviderHealth() {
  const providers = useProviders()
  const history = useTaskHistory()

  const view = useMemo(() => {
    if (!providers.data || !history.data) return null
    const today = new Date()
    const endDate = localDay(today)
    const endMs = Date.parse(`${endDate}T00:00:00`)
    const dayIndex = (iso: string) => {
      const d = new Date(iso)
      const startOfDay = Date.parse(`${localDay(d)}T00:00:00`)
      return DAYS - 1 - Math.round((endMs - startOfDay) / 86_400_000)
    }

    const ok = new Map<ProviderId, number[]>()
    const failed = new Map<ProviderId, TaskLog[][]>()
    for (const p of providers.data) {
      ok.set(p.id, Array(DAYS).fill(0))
      failed.set(p.id, Array.from({ length: DAYS }, () => []))
    }
    for (const t of history.data) {
      const day = dayIndex(t.at)
      if (day < 0 || day >= DAYS) continue
      if (t.status === 'failed' && t.routedTo) failed.get(t.routedTo)?.[day].push(t)
      if (t.status !== 'failed' && t.routedTo) {
        const row = ok.get(t.routedTo)
        if (row) row[day] += 1
      }
      if (t.fallbackFrom) failed.get(t.fallbackFrom)?.[day].push(t)
    }

    const services: UptimeService[] = providers.data
      .map((p) => {
        const okRow = ok.get(p.id) ?? []
        const failRow = failed.get(p.id) ?? []
        const incidents: Record<number, Incident> = {}
        const idle = new Set<number>()
        let okTotal = 0
        let failTotal = 0
        for (let day = 0; day < DAYS; day++) {
          const s = okRow[day] ?? 0
          const f = failRow[day] ?? []
          okTotal += s
          failTotal += f.length
          if (f.length === 0) {
            if (s === 0) idle.add(day)
            continue
          }
          incidents[day] = {
            title: f.length === 1 ? 'A call failed' : `${f.length} calls failed`,
            status: s === 0 ? 'down' : 'degraded',
            detail: `${f.length} of ${s + f.length} calls failed`,
            updates: f
              .slice()
              .sort((a, b) => a.at.localeCompare(b.at))
              .map((t) => ({
                time: timeOf(t.at),
                label: t.label,
                note: t.reason ?? (t.routedTo && t.routedTo !== p.id ? `Retried on ${providerLabel(t.routedTo)}.` : 'Failed.'),
              })),
          }
        }
        const calls = okTotal + failTotal
        return { id: p.id, calls, service: { name: p.name, incidents, idle, uptime: calls ? (100 * okTotal) / calls : null } }
      })
      // An unconfigured custom endpoint with no traffic is noise.
      .filter((row) => row.id !== 'custom' || row.calls > 0)
      .map((row) => row.service)

    return { services, endDate }
  }, [providers.data, history.data])

  if (!view) return <div className="skeleton uptime-skeleton" aria-busy="true" aria-label="Loading provider health" />
  return <UptimeCard services={view.services} days={DAYS} endDate={view.endDate} okText="No errors today" hint="Hover or tap a day to see failed calls" />
}
