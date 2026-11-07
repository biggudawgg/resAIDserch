import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Archive, ArchiveRestore, ChevronDown, Lightbulb, Search } from 'lucide-react'
import { api } from '../api/client'
import { useApiMutation, useBeliefs, useMemberName } from '../api/hooks'
import type { Belief, BeliefStatus } from '../api/types'
import { Sparkline } from '../components/charts/Sparkline'
import { Button } from '../components/ui/Button'
import { FilterTabs, Select } from '../components/ui/Field'
import { ConfidenceMeter } from '../components/ui/Meter'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState, ErrorState, SkeletonCard } from '../components/ui/States'
import { BeliefStatusBadge } from '../components/ui/StatusBadges'
import { cx } from '../lib/cx'
import { formatAuthors, formatDate, pct, plural, timeAgo } from '../lib/format'
import { useOpenPaper } from '../lib/hooks'
import { useUI } from '../lib/ui'

type Sort = 'confidence' | 'updated'

export function Beliefs() {
  const beliefs = useBeliefs()
  const [params] = useSearchParams()
  const focus = params.get('focus')
  const [filter, setFilter] = useState<BeliefStatus>('active')
  const [sort, setSort] = useState<Sort>('confidence')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(focus)
  const scrolledFor = useRef<string | null>(null)

  useEffect(() => {
    if (!focus || !beliefs.data || scrolledFor.current === focus) return
    const target = beliefs.data.find((b) => b.id === focus)
    if (!target) return
    scrolledFor.current = focus
    setFilter(target.status)
    setExpanded(focus)
    requestAnimationFrame(() => document.getElementById(`belief-${focus}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }, [focus, beliefs.data])

  if (beliefs.isError) return <ErrorState error={beliefs.error} onRetry={() => beliefs.refetch()} />

  const all = beliefs.data ?? []
  const needle = query.trim().toLowerCase()
  const visible = all
    .filter((b) => b.status === filter && (!needle || b.statement.toLowerCase().includes(needle)))
    .sort((a, b) => (sort === 'confidence' ? b.confidence - a.confidence : b.updatedAt.localeCompare(a.updatedAt)))
  const count = (status: BeliefStatus) => all.filter((b) => b.status === status).length

  return (
    <div className="page">
      <PageHeader title="Beliefs" description="What your team currently holds true, how confident it is, and the evidence behind each statement." />

      <div className="toolbar">
        <FilterTabs
          label="Filter beliefs by status"
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'active', label: 'Active', count: count('active') },
            { value: 'proposed', label: 'Needs review', count: count('proposed') },
            { value: 'archived', label: 'Archived', count: count('archived') },
            { value: 'rejected', label: 'Rejected', count: count('rejected') },
          ]}
        />
        <div className="toolbar-right">
          <label className="search-input">
            <Search aria-hidden />
            <input
              className="input"
              type="search"
              placeholder="Filter by text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Filter beliefs by text"
            />
          </label>
          <Select value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label="Sort beliefs">
            <option value="confidence">Highest confidence</option>
            <option value="updated">Recently updated</option>
          </Select>
        </div>
      </div>

      {!beliefs.data ? (
        <div className="beliefs-list">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Lightbulb />}
          title={needle ? 'No beliefs match that text' : 'Nothing here'}
          description={filter === 'proposed' ? 'Draft beliefs appear here when a research run finishes.' : undefined}
        />
      ) : (
        <ul className="beliefs-list">
          {visible.map((b) => (
            <BeliefRow key={b.id} belief={b} expanded={expanded === b.id} onToggle={() => setExpanded((cur) => (cur === b.id ? null : b.id))} />
          ))}
        </ul>
      )}
    </div>
  )
}

function BeliefRow({ belief, expanded, onToggle }: { belief: Belief; expanded: boolean; onToggle: () => void }) {
  const nameOf = useMemberName()
  const openPaper = useOpenPaper()
  const { toast } = useUI()
  const update = useApiMutation((status: 'active' | 'archived') => api.updateBelief(belief.id, { status }))
  const first = belief.history[0]?.confidence ?? belief.confidence
  const delta = Math.round((belief.confidence - first) * 100)
  const points = belief.history.map((h) => ({
    t: new Date(h.at).getTime(),
    v: h.confidence,
    label: formatDate(h.at),
    detail: `${h.event} · ${nameOf(h.by)}`,
  }))

  return (
    <li id={`belief-${belief.id}`} className={cx('belief', expanded && 'is-expanded')}>
      <button type="button" className="belief-summary" aria-expanded={expanded} onClick={onToggle}>
        <span className="belief-main">
          <span className="belief-text">{belief.statement}</span>
          <span className="belief-meta">
            {belief.question ? `From “${belief.question.question}”` : 'Added manually'} · {plural(belief.sourcePapers.length, 'source')} · updated{' '}
            {timeAgo(belief.updatedAt)}
          </span>
        </span>
        <span className="belief-side">
          <ConfidenceMeter value={belief.confidence} variant="inline" />
          <ChevronDown className="belief-chevron" aria-hidden />
        </span>
      </button>

      {expanded && (
        <div className="belief-body">
          <div className="belief-grid">
            <div>
              <h4 className="mini-heading">Evidence</h4>
              <p className="belief-evidence-text">{belief.evidence}</p>
              <h4 className="mini-heading">Sources</h4>
              {belief.sourcePapers.length === 0 ? (
                <p className="subtle small">No sources linked.</p>
              ) : (
                <ul className="paper-list">
                  {belief.sourcePapers.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="paper-link" onClick={() => openPaper(p.id)}>
                        <span className="paper-link-title">{p.title}</span>
                        <span className="paper-link-meta">
                          {formatAuthors(p.authors, p.etAl)} · {p.year ?? 'n.d.'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h4 className="mini-heading">
                Confidence over time
                <span className="mini-heading-note">
                  {pct(first)} → {pct(belief.confidence)} ({delta >= 0 ? '+' : ''}
                  {delta} pts)
                </span>
              </h4>
              {points.length > 1 && (
                <Sparkline points={points} ariaLabel={`Confidence went from ${pct(first)} to ${pct(belief.confidence)}`} formatValue={pct} />
              )}
              <ol className="history">
                {[...belief.history].reverse().map((h) => (
                  <li key={`${h.at}-${h.event}`}>
                    <span className="history-value">{pct(h.confidence)}</span>
                    <span className="history-event">{h.event}</span>
                    <span className="history-meta">
                      {nameOf(h.by)} · {formatDate(h.at)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="belief-actions">
            <BeliefStatusBadge status={belief.status} />
            {belief.approvedBy && (
              <span className="subtle small">
                Approved by {nameOf(belief.approvedBy)} {timeAgo(belief.approvedAt)}
              </span>
            )}
            <span className="belief-actions-right">
              {belief.question && (
                <Link className="btn btn-ghost btn-sm" to={`/research/${belief.question.id}`}>
                  Open question
                </Link>
              )}
              {belief.status === 'proposed' && belief.question && (
                <Link className="btn btn-primary btn-sm" to={`/research/${belief.question.id}`}>
                  Review draft
                </Link>
              )}
              {belief.status === 'active' && (
                <Button size="sm" icon={<Archive />} loading={update.isPending} onClick={() => update.mutate('archived', { onSuccess: () => toast('Belief archived') })}>
                  Archive
                </Button>
              )}
              {belief.status === 'archived' && (
                <Button size="sm" icon={<ArchiveRestore />} loading={update.isPending} onClick={() => update.mutate('active', { onSuccess: () => toast('Belief restored') })}>
                  Restore
                </Button>
              )}
            </span>
          </div>
        </div>
      )}
    </li>
  )
}
