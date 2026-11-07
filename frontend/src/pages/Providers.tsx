import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Table2 } from 'lucide-react'
import { api } from '../api/client'
import { useApiMutation, useProviders, useRouting, useTasks, useUsage } from '../api/hooks'
import type { Priority, Provider, ProviderId, Routing, TaskLog, Usage } from '../api/types'
import { ColumnChart, type ColumnDatum } from '../components/charts/ColumnChart'
import { SpendBreakdown } from '../components/charts/SpendBreakdown'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Segmented, Select, Switch } from '../components/ui/Field'
import { PageHeader } from '../components/ui/PageHeader'
import { ProviderChip, ProviderDot } from '../components/ui/ProviderChip'
import { EmptyState, ErrorState, SkeletonCard } from '../components/ui/States'
import { StatTile } from '../components/ui/StatTile'
import { ProviderStatusBadge } from '../components/ui/StatusBadges'
import { cx } from '../lib/cx'
import { compact, formatDateTime, formatDuration, formatNumber, formatShortDate, formatUsd, formatUsdPrecise, plural } from '../lib/format'
import { PRIORITY_META, PROVIDER_ORDER, providerLabel } from '../lib/providers'
import { useUI } from '../lib/ui'

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
]

export function Providers() {
  const providers = useProviders()
  const routing = useRouting()
  const [days, setDays] = useState('14')
  const usage = useUsage(Number(days))
  const [taskProvider, setTaskProvider] = useState('')
  const tasks = useTasks(taskProvider)

  if (providers.isError) return <ErrorState error={providers.error} onRetry={() => providers.refetch()} />

  return (
    <div className="page">
      <PageHeader
        title="Providers & usage"
        description="Which AI handles each task, why, and what it costs. Work is routed to one provider at a time, with automatic fallback."
      />

      <section className="section" aria-labelledby="providers-heading">
        <h2 id="providers-heading" className="section-title">
          Connected providers
        </h2>
        {!providers.data ? (
          <SkeletonCard lines={3} />
        ) : (
          <div className="provider-grid">
            {providers.data.map((p) => (
              <ProviderCard key={p.id} provider={p} />
            ))}
          </div>
        )}
      </section>

      <section className="section">{routing.data && providers.data ? <RoutingCard routing={routing.data} providers={providers.data} /> : <SkeletonCard lines={6} />}</section>

      <section className="section" aria-labelledby="usage-heading">
        <div className="section-head">
          <h2 id="usage-heading" className="section-title">
            Usage
          </h2>
          <Segmented label="Date range" value={days} onChange={setDays} options={RANGES} size="sm" />
        </div>
        {usage.data ? <UsagePanel usage={usage.data} refreshing={usage.isPlaceholderData} /> : <SkeletonCard lines={6} />}
      </section>

      <section className="section">
        <Card
          title="Task log"
          description="Every model call: which provider handled it, why it was chosen, and what it cost."
          actions={
            <Select value={taskProvider} onChange={(event) => setTaskProvider(event.target.value)} aria-label="Filter the task log by provider">
              <option value="">All providers</option>
              {PROVIDER_ORDER.map((p) => (
                <option key={p} value={p}>
                  {providerLabel(p)}
                </option>
              ))}
              <option value="demo">Demo heuristic</option>
            </Select>
          }
          flush
        >
          {tasks.data ? <TaskTable tasks={tasks.data} /> : <SkeletonCard lines={5} />}
        </Card>
      </section>
    </div>
  )
}

function ProviderCard({ provider: p }: { provider: Provider }) {
  return (
    <div className="provider-card">
      <div className="provider-card-head">
        <span className="provider-name">
          <ProviderDot provider={p.id} />
          {p.name}
        </span>
        <ProviderStatusBadge status={p.status} />
      </div>
      <p className="small muted">{p.blurb}</p>
      <dl className="kv kv-tight">
        <div>
          <dt>Model</dt>
          <dd className="mono">{p.model || '—'}</dd>
        </div>
        <div>
          <dt>This month</dt>
          <dd>
            {formatUsd(p.month.costUsd)} · {plural(p.month.calls, 'call')}
          </dd>
        </div>
        <div>
          <dt>Average latency</dt>
          <dd>{p.month.avgLatencyMs ? formatDuration(p.month.avgLatencyMs) : '—'}</dd>
        </div>
      </dl>
      <Link to={`/settings/keys#${p.id}`} className="btn btn-secondary btn-sm">
        {p.hasKey ? 'Manage key' : 'Connect'}
      </Link>
    </div>
  )
}

function ProviderSelect({
  value,
  onChange,
  label,
  providers,
  exclude,
  allowNone = false,
}: {
  value: ProviderId | null
  onChange: (value: ProviderId | null) => void
  label: string
  providers: Provider[]
  exclude?: ProviderId
  allowNone?: boolean
}) {
  return (
    <Select value={value ?? ''} onChange={(event) => onChange((event.target.value || null) as ProviderId | null)} aria-label={label}>
      {allowNone && <option value="">No fallback</option>}
      {providers
        .filter((p) => p.id !== exclude)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.short}
            {p.status === 'connected' || p.status === 'untested' ? '' : ' (no key)'}
          </option>
        ))}
    </Select>
  )
}

function RoutingCard({ routing, providers }: { routing: Routing; providers: Provider[] }) {
  const { toast } = useUI()
  const save = useApiMutation((body: Parameters<typeof api.saveRouting>[0]) => api.saveRouting(body))
  const update = (body: Parameters<typeof api.saveRouting>[0], message: string) =>
    save.mutate(body, { onSuccess: () => toast(message), onError: (error) => toast(error.message, { tone: 'error' }) })

  return (
    <Card title="Routing policy" description="Each task goes to one provider. If it errors or has no key, the task retries on the fallback.">
      <div className="routing-top">
        <div className="field">
          <span className="field-label">Optimise for</span>
          <Segmented
            label="Optimise routing for"
            value={routing.priority}
            onChange={(value: Priority) => update({ priority: value }, `Routing now optimises for ${PRIORITY_META[value].label.toLowerCase()}`)}
            options={(['quality', 'balanced', 'speed', 'cost'] as Priority[]).map((value) => ({ value, label: PRIORITY_META[value].label }))}
          />
          <p className="field-hint">{PRIORITY_META[routing.priority].description} Changing this resets the task rules below.</p>
        </div>
        <div className="routing-switches">
          <Switch
            checked={routing.autoFallback}
            onChange={(value) => update({ autoFallback: value }, value ? 'Automatic fallback is on' : 'Automatic fallback is off')}
            label="Retry on the next-best provider"
            description="When a provider errors, is rate-limited, or has no key."
          />
          <Switch
            checked={routing.allowOverride}
            onChange={(value) => update({ allowOverride: value }, value ? 'Per-question override allowed' : 'Per-question override disabled')}
            label="Allow per-question override"
            description="Lets anyone force a single provider when asking or re-running."
          />
        </div>
      </div>
      <div className="table-wrap">
        <table className="table routing-table">
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Primary</th>
              <th scope="col">Fallback</th>
              <th scope="col">Why</th>
            </tr>
          </thead>
          <tbody>
            {routing.rules.map((rule) => (
              <tr key={rule.task}>
                <td>
                  <span className="table-title-static">{rule.label}</span>
                  <span className="table-sub">{rule.description}</span>
                </td>
                <td>
                  <ProviderSelect
                    providers={providers}
                    label={`Primary provider for ${rule.label}`}
                    value={rule.primary}
                    onChange={(value) =>
                      value &&
                      update(
                        { rules: [{ task: rule.task, primary: value, fallback: rule.fallback === value ? null : rule.fallback }] },
                        `${rule.label} now routes to ${providerLabel(value)}`,
                      )
                    }
                  />
                </td>
                <td>
                  <ProviderSelect
                    providers={providers}
                    label={`Fallback provider for ${rule.label}`}
                    value={rule.fallback}
                    exclude={rule.primary}
                    allowNone
                    onChange={(value) =>
                      update(
                        { rules: [{ task: rule.task, primary: rule.primary, fallback: value }] },
                        value ? `${rule.label} falls back to ${providerLabel(value)}` : `${rule.label} has no fallback`,
                      )
                    }
                  />
                </td>
                <td className="small muted routing-reason">{rule.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function UsagePanel({ usage, refreshing }: { usage: Usage; refreshing: boolean }) {
  const [showTable, setShowTable] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const chartData: ColumnDatum[] = usage.daily.map((day) => {
    const parts = PROVIDER_ORDER.filter((p) => day.byProvider[p] > 0)
    return {
      key: day.date,
      label: formatShortDate(day.date),
      value: day.costUsd,
      current: day.date === today,
      ariaLabel: `${formatShortDate(day.date)}: ${formatUsdPrecise(day.costUsd)}, ${plural(day.calls, 'call')}`,
      tooltip: (
        <>
          <strong className="tt-value">{formatUsdPrecise(day.costUsd)}</strong>
          <span className="tt-label">
            {formatShortDate(day.date)} · {plural(day.calls, 'call')}
          </span>
          {parts.map((p) => (
            <span key={p} className="tt-row">
              <span className={cx('tt-key', `bg-${p}`)} aria-hidden />
              <span>{providerLabel(p)}</span>
              <span className="tt-row-value">{formatUsdPrecise(day.byProvider[p])}</span>
            </span>
          ))}
        </>
      ),
    }
  })

  return (
    <div className={cx('usage-body', refreshing && 'is-refreshing')}>
      <div className="kpi-grid">
        <StatTile label="Spend" value={formatUsd(usage.totals.costUsd)} sub={`Last ${usage.days} days`} />
        <StatTile label="Model calls" value={formatNumber(usage.totals.calls)} sub={`${usage.totals.demoCalls} ran as demo heuristics`} />
        <StatTile label="Tokens" value={compact(usage.totals.tokens)} sub="Input and output" />
        <StatTile label="Fallbacks" value={usage.totals.fallbacks} sub="Retried on the next-best provider" />
      </div>
      <div className="usage-grid">
        <Card
          className="usage-chart-card"
          title="Daily spend"
          description="All providers, per day. Hover a day for the split."
          actions={
            <Button size="sm" variant="ghost" icon={showTable ? <BarChart3 /> : <Table2 />} onClick={() => setShowTable((v) => !v)}>
              {showTable ? 'Show chart' : 'Show table'}
            </Button>
          }
        >
          {usage.totals.costUsd === 0 ? (
            <EmptyState compact title="No paid usage in this range" description="Groq's free tier and demo heuristics cost nothing." />
          ) : showTable ? (
            <div className="table-wrap table-scroll">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    {PROVIDER_ORDER.slice(0, 3).map((p) => (
                      <th key={p} scope="col" className="num">
                        {providerLabel(p)}
                      </th>
                    ))}
                    <th scope="col" className="num">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...usage.daily].reverse().map((day) => (
                    <tr key={day.date}>
                      <td>{formatShortDate(day.date)}</td>
                      {PROVIDER_ORDER.slice(0, 3).map((p) => (
                        <td key={p} className="num">
                          {formatUsdPrecise(day.byProvider[p])}
                        </td>
                      ))}
                      <td className="num strong">{formatUsdPrecise(day.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ColumnChart data={chartData} formatTick={(v) => `$${v.toFixed(2)}`} ariaLabel={`Daily spend over the last ${usage.days} days`} />
          )}
        </Card>
        <Card title="Spend by provider" description={`Last ${usage.days} days`}>
          <SpendBreakdown items={usage.byProvider} />
        </Card>
        <Card title="Spend by task" description="Where the money goes" flush>
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col" className="num">
                    Calls
                  </th>
                  <th scope="col" className="num">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {usage.byTask.map((t) => (
                  <tr key={t.task}>
                    <td>{t.label}</td>
                    <td className="num">{t.calls}</td>
                    <td className="num">{formatUsdPrecise(t.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}

function TaskTable({ tasks }: { tasks: TaskLog[] }) {
  if (tasks.length === 0) return <EmptyState compact title="No calls for this provider yet" />
  return (
    <div className="table-wrap table-scroll-tall">
      <table className="table table-compact">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Task</th>
            <th scope="col">Handled by</th>
            <th scope="col">Why</th>
            <th scope="col" className="num">
              Tokens
            </th>
            <th scope="col" className="num">
              Cost
            </th>
            <th scope="col" className="num">
              Latency
            </th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id}>
              <td className="nowrap subtle">{formatDateTime(t.at)}</td>
              <td className="nowrap">
                {t.questionId ? <Link to={`/research/${t.questionId}`}>{t.label}</Link> : t.label}
              </td>
              <td className="nowrap">
                {t.provider === 'demo' ? (
                  <span className="handled-demo">
                    <ProviderChip provider="demo" />
                    {t.routedTo && <span className="subtle small">routed to {providerLabel(t.routedTo)}</span>}
                  </span>
                ) : (
                  <span className="handled">
                    <ProviderChip provider={t.provider} model={t.model} />
                    {t.status === 'fallback' && <Badge tone="warn">Fallback from {providerLabel(t.fallbackFrom)}</Badge>}
                  </span>
                )}
              </td>
              <td className="small muted task-reason">{t.reason ?? '—'}</td>
              <td className="num">{t.inputTokens + t.outputTokens > 0 ? compact(t.inputTokens + t.outputTokens) : '—'}</td>
              <td className="num">{formatUsdPrecise(t.costUsd)}</td>
              <td className="num">{formatDuration(t.latencyMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
