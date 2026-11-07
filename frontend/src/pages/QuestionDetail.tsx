import { Fragment, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArchiveRestore,
  Check,
  Clock,
  Copy,
  Download,
  FileDown,
  FileText,
  History,
  Info,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Route,
  Trash2,
} from 'lucide-react'
import { api } from '../api/client'
import { useApiMutation, useMemberName, useQuestion, useRouting } from '../api/hooks'
import type { Belief, Contradiction, Findings, ProviderId, RunDetail, Stance } from '../api/types'
import { DeadEndCard } from '../components/DeadEndCard'
import { PipelineTracker } from '../components/research/Pipeline'
import { RichText } from '../components/research/RichText'
import { Avatar } from '../components/ui/Avatar'
import { Badge } from '../components/ui/Badge'
import { Button, IconButton } from '../components/ui/Button'
import { Callout, Card } from '../components/ui/Card'
import { Field, FilterTabs, Textarea } from '../components/ui/Field'
import { Menu } from '../components/ui/Menu'
import { ConfidenceMeter } from '../components/ui/Meter'
import { ConfirmModal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { ProviderDot } from '../components/ui/ProviderChip'
import { EmptyState, ErrorState, SkeletonCard } from '../components/ui/States'
import { BeliefStatusBadge, QuestionStatusBadge, StanceBadge } from '../components/ui/StatusBadges'
import { cx } from '../lib/cx'
import { formatAuthors, formatDateTime, formatDuration, formatNumber, formatUsdPrecise, plural, shortTitle, timeAgo } from '../lib/format'
import { useOpenPaper } from '../lib/hooks'
import { PRIORITY_META, PROVIDER_ORDER, providerLabel } from '../lib/providers'
import { useUI } from '../lib/ui'

export function QuestionDetail() {
  const { id } = useParams<{ id: string }>()
  const question = useQuestion(id)
  const routing = useRouting()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const nameOf = useMemberName()
  const openPaper = useOpenPaper()
  const { toast } = useUI()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const rerun = useApiMutation((provider: ProviderId | null) => api.rerun(id as string, provider))
  const archive = useApiMutation((archived: boolean) => api.updateQuestion(id as string, { archived }))
  const remove = useMutation({
    mutationFn: () => api.deleteQuestion(id as string),
    onSuccess: () => {
      navigate('/research')
      toast('Question deleted')
      qc.removeQueries({ queryKey: ['question', id] })
      qc.invalidateQueries()
    },
    onError: (error: Error) => toast(error.message, { tone: 'error' }),
  })

  if (question.isError) return <ErrorState error={question.error} onRetry={() => question.refetch()} />
  const q = question.data
  if (!q) {
    return (
      <div className="page">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={5} />
      </div>
    )
  }

  const running = q.status === 'running'
  const startRun = (provider: ProviderId | null) =>
    rerun.mutate(provider, {
      onSuccess: () =>
        toast('Research started', {
          description: provider ? `Every step is forced to ${providerLabel(provider)}.` : 'Using automatic routing.',
        }),
      onError: (error) => toast(error.message, { tone: 'error' }),
    })

  const copyBriefing = async () => {
    try {
      await navigator.clipboard.writeText(await api.briefing(q.id))
      toast('Briefing copied as Markdown')
    } catch {
      toast("Couldn't copy the briefing", { tone: 'error' })
    }
  }

  const overrideAllowed = routing.data?.allowOverride ?? true

  return (
    <div className="page">
      <PageHeader
        breadcrumb={[{ label: 'Research', to: '/research' }, { label: 'Question' }]}
        title={q.question}
        description={q.context ?? undefined}
        actions={
          <>
            <Menu
              label="Re-run research"
              trigger={(props) => (
                <Button icon={<RefreshCw />} disabled={running || rerun.isPending} {...props}>
                  Re-run
                </Button>
              )}
              items={[
                {
                  label: 'Automatic routing',
                  hint: routing.data ? PRIORITY_META[routing.data.priority].label : undefined,
                  icon: <Route />,
                  onSelect: () => startRun(null),
                },
                'separator',
                ...PROVIDER_ORDER.map((p) => ({
                  label: `Use ${providerLabel(p)} for every step`,
                  icon: <ProviderDot provider={p} />,
                  disabled: !overrideAllowed,
                  hint: overrideAllowed ? undefined : 'Override off',
                  onSelect: () => startRun(p),
                })),
              ]}
            />
            <Menu
              label="Export"
              trigger={(props) => (
                <Button icon={<Download />} disabled={!q.findings} {...props}>
                  Export
                </Button>
              )}
              items={[
                {
                  label: 'Download briefing (.md)',
                  icon: <FileDown />,
                  onSelect: () => {
                    window.location.href = api.briefingUrl(q.id)
                  },
                },
                { label: 'Copy briefing as Markdown', icon: <Copy />, onSelect: copyBriefing },
                { label: 'Export to Google Docs', hint: 'Needs Google sign-in', icon: <FileText />, disabled: true, onSelect: () => undefined },
              ]}
            />
            <Menu
              label="More actions"
              trigger={(props) => <IconButton label="More actions" icon={<MoreHorizontal />} variant="secondary" {...props} />}
              items={[
                q.archived
                  ? { label: 'Restore question', icon: <ArchiveRestore />, onSelect: () => archive.mutate(false, { onSuccess: () => toast('Question restored') }) }
                  : { label: 'Archive question', icon: <Archive />, onSelect: () => archive.mutate(true, { onSuccess: () => toast('Question archived') }) },
                'separator',
                { label: 'Delete question', icon: <Trash2 />, danger: true, onSelect: () => setConfirmDelete(true) },
              ]}
            />
          </>
        }
      />

      <div className="meta-row">
        <QuestionStatusBadge status={q.status} />
        <span className="meta-item">
          <Avatar name={nameOf(q.createdBy)} size="xs" />
          Asked by {nameOf(q.createdBy)} · {timeAgo(q.createdAt)}
        </span>
        {q.lastRunAt && (
          <span className="meta-item">
            <History aria-hidden /> Last run {timeAgo(q.lastRunAt)}
          </span>
        )}
        {q.findings && (
          <span className="meta-item">
            <FileText aria-hidden /> {plural(q.findings.papers.length, 'paper')} used of {q.findings.screened} screened
          </span>
        )}
      </div>

      {q.run && (
        <Card title="Research pipeline" description={pipelineDescription(q.run)} actions={<RunTotals run={q.run} />}>
          <PipelineTracker key={q.run.id} run={q.run} />
        </Card>
      )}

      {q.run?.status === 'failed' && (
        <Callout
          tone="crit"
          title="This run stopped with an error"
          action={
            <Button icon={<RefreshCw />} onClick={() => startRun(null)} loading={rerun.isPending}>
              Try again
            </Button>
          }
        >
          {q.run.error}
        </Callout>
      )}

      {!q.run && (
        <EmptyState
          title="No research has run for this question"
          action={
            <Button variant="primary" icon={<RefreshCw />} onClick={() => startRun(null)}>
              Start research
            </Button>
          }
        />
      )}

      {!q.findings && running && (
        <Card title="Findings">
          <EmptyState
            compact
            icon={<Loader2 className="spin" />}
            title="The agent is working"
            description="The briefing, evidence, contradictions and a draft belief appear here when the run finishes."
          />
        </Card>
      )}

      {q.findings && (
        <div className="detail-grid">
          <div className="stack">
            <Card title="Briefing" description={running ? 'From the previous run. A new run is in progress.' : undefined}>
              <RichText text={q.findings.synthesis} />
            </Card>
            <EvidenceCard findings={q.findings} />
            {q.findings.contradictions.length > 0 && <ContradictionsCard items={q.findings.contradictions} />}
          </div>

          <div className="stack">
            {q.belief && <BeliefCard belief={q.belief} questionRunning={running} />}
            <Card title="How confident, and why">
              <dl className="kv kv-tight">
                <div>
                  <dt>Supporting claims</dt>
                  <dd>{q.findings.confidence.supporting}</dd>
                </div>
                <div>
                  <dt>Limiting claims</dt>
                  <dd>{q.findings.confidence.limiting}</dd>
                </div>
                <div>
                  <dt>Context only</dt>
                  <dd>{q.findings.confidence.neutral}</dd>
                </div>
              </dl>
              <p className="small muted spaced">{q.findings.confidence.rationale}</p>
            </Card>
            {q.deadEnds.length > 0 && (
              <Card title="Dead ends" description="Approaches the evidence argues against.">
                <div className="stack-sm">
                  {q.deadEnds.map((d) => (
                    <DeadEndCard key={d.id} deadEnd={d} showQuestion={false} />
                  ))}
                </div>
              </Card>
            )}
            <Card title="Papers" description={`${q.findings.papers.length} used · ${q.findings.screened} screened`}>
              <ul className="paper-list">
                {q.findings.papers.map((p) => (
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
            </Card>
            {q.runs.length > 1 && (
              <Card title="Run history">
                <ul className="run-history">
                  {q.runs.map((r) => (
                    <li key={r.id}>
                      <span>{formatDateTime(r.startedAt)}</span>
                      <Badge tone={r.status === 'completed' ? 'good' : r.status === 'failed' ? 'crit' : 'info'}>{r.status}</Badge>
                      <span className="subtle">{formatDuration(r.totals.durationMs)}</span>
                      <span className="num">{formatUsdPrecise(r.totals.costUsd)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this question?"
        description="Its runs, claims and unreviewed drafts are deleted. Approved beliefs and ruled-out dead ends stay in team memory."
        confirmLabel="Delete question"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}

function pipelineDescription(run: RunDetail): string {
  if (run.status === 'running') return `Started ${timeAgo(run.startedAt)}. Select a step to see which provider handled it and why.`
  if (run.status === 'failed') return 'Stopped with an error.'
  return `Finished ${timeAgo(run.finishedAt)}. Select a step to see which provider handled it and why.`
}

function RunTotals({ run }: { run: RunDetail }) {
  const tokens = run.totals.inputTokens + run.totals.outputTokens
  return (
    <span className="run-totals">
      <Clock aria-hidden />
      {formatDuration(run.totals.durationMs)}
      {tokens > 0 && <span>· {formatNumber(tokens)} tokens</span>}
      <span>· {formatUsdPrecise(run.totals.costUsd)}</span>
      {run.origin === 'sample' && <Badge>Sample run</Badge>}
      {run.origin === 'demo' && <Badge tone="info">Demo run</Badge>}
      {run.forcedProvider && <Badge tone="accent">Forced: {providerLabel(run.forcedProvider)}</Badge>}
    </span>
  )
}

function BeliefCard({ belief, questionRunning }: { belief: Belief; questionRunning: boolean }) {
  const nameOf = useMemberName()
  const { toast } = useUI()
  const [mode, setMode] = useState<'view' | 'edit' | 'reject'>('view')
  const [draft, setDraft] = useState(belief.statement)
  const [reason, setReason] = useState('')
  const approve = useApiMutation((statement?: string) => api.approveBelief(belief.id, statement))
  const reject = useApiMutation((why: string) => api.rejectBelief(belief.id, why))
  const proposed = belief.status === 'proposed'

  useEffect(() => {
    setDraft(belief.statement)
    setMode('view')
  }, [belief.id, belief.statement])

  const onApprove = (statement?: string) =>
    approve.mutate(statement, {
      onSuccess: () => toast('Belief approved', { description: 'It is now part of team memory.' }),
      onError: (error) => toast(error.message, { tone: 'error' }),
    })

  return (
    <Card
      title={proposed ? 'Draft belief' : 'Team belief'}
      description={proposed ? 'Approve it into team memory, edit the wording first, or reject it.' : undefined}
      actions={<BeliefStatusBadge status={belief.status} />}
      className={cx(proposed && 'card-highlight')}
    >
      {mode === 'edit' ? (
        <Field label="Statement" htmlFor="belief-edit">
          <Textarea id="belief-edit" data-autofocus rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} />
        </Field>
      ) : (
        <p className="belief-statement">{belief.statement}</p>
      )}
      <ConfidenceMeter value={belief.confidence} />
      <p className="belief-evidence">{belief.evidence}</p>
      {belief.sourcePapers.length > 0 && (
        <p className="small subtle spaced">
          {plural(belief.sourcePapers.length, 'source')}:{' '}
          {belief.sourcePapers
            .slice(0, 3)
            .map((p) => shortTitle(p.title, 28))
            .join(', ')}
          {belief.sourcePapers.length > 3 && ` and ${belief.sourcePapers.length - 3} more`}
        </p>
      )}

      {mode === 'reject' && (
        <div className="spaced">
          <Field label="Why reject it?" htmlFor="belief-reject" optional hint="Saved in the belief's history so the team knows why.">
            <Textarea id="belief-reject" data-autofocus rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
        </div>
      )}

      {proposed && (
        <div className="card-actions-row">
          {mode === 'view' && (
            <>
              <Button variant="primary" icon={<Check />} loading={approve.isPending} onClick={() => onApprove()}>
                Approve
              </Button>
              <Button icon={<Pencil />} onClick={() => setMode('edit')}>
                Edit
              </Button>
              <Button variant="ghost" onClick={() => setMode('reject')}>
                Reject
              </Button>
            </>
          )}
          {mode === 'edit' && (
            <>
              <Button variant="primary" icon={<Check />} loading={approve.isPending} disabled={draft.trim().length < 4} onClick={() => onApprove(draft.trim())}>
                Save and approve
              </Button>
              <Button
                onClick={() => {
                  setMode('view')
                  setDraft(belief.statement)
                }}
              >
                Cancel
              </Button>
            </>
          )}
          {mode === 'reject' && (
            <>
              <Button
                variant="danger"
                loading={reject.isPending}
                onClick={() =>
                  reject.mutate(reason.trim(), {
                    onSuccess: () => toast('Draft rejected'),
                    onError: (error) => toast(error.message, { tone: 'error' }),
                  })
                }
              >
                Reject draft
              </Button>
              <Button onClick={() => setMode('view')}>Cancel</Button>
            </>
          )}
        </div>
      )}

      {belief.status === 'active' && belief.approvedBy && (
        <p className="small subtle spaced">
          Approved by {nameOf(belief.approvedBy)} · {timeAgo(belief.approvedAt)} · <Link to={`/beliefs?focus=${belief.id}`}>View in beliefs</Link>
        </p>
      )}
      {questionRunning && proposed && <p className="small subtle spaced">A new run is in progress and will replace this draft when it finishes.</p>}
    </Card>
  )
}

const EVIDENCE_PREVIEW = 6

function EvidenceCard({ findings }: { findings: Findings }) {
  const [filter, setFilter] = useState<'all' | Stance>('all')
  const [showAll, setShowAll] = useState(false)
  const openPaper = useOpenPaper()
  const count = (stance: Stance) => findings.claims.filter((c) => c.stance === stance).length
  const matching = findings.claims.filter((c) => filter === 'all' || c.stance === filter)
  const claims = showAll ? matching : matching.slice(0, EVIDENCE_PREVIEW)

  return (
    <Card
      title="Evidence"
      description={`${plural(findings.claims.length, 'claim')} from ${plural(findings.papers.length, 'paper')}`}
      actions={
        <FilterTabs
          label="Filter evidence by stance"
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: 'All', count: findings.claims.length },
            { value: 'supports', label: 'Supports', count: count('supports') },
            { value: 'limits', label: 'Limits', count: count('limits') },
            { value: 'neutral', label: 'Context', count: count('neutral') },
          ]}
        />
      }
    >
      {claims.length === 0 ? (
        <EmptyState compact title="No claims in this group" />
      ) : (
        <ul className="claims">
          {claims.map((c) => (
            <li key={c.id} className={cx('claim', `claim-${c.stance}`)}>
              <div className="claim-head">
                <StanceBadge stance={c.stance} />
                <span className="claim-kind">{c.kind === 'quote' ? 'Verbatim from the abstract' : 'Summary of the paper'}</span>
              </div>
              <blockquote className="claim-text">{c.kind === 'quote' ? `“${c.text}”` : c.text}</blockquote>
              {c.paper && (
                <button type="button" className="claim-source" onClick={() => openPaper(c.paper!.id)}>
                  <FileText aria-hidden />
                  <span className="claim-source-title">{c.paper.title}</span>
                  <span className="subtle">
                    {formatAuthors(c.paper.authors, c.paper.etAl)}, {c.paper.year ?? 'n.d.'}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {matching.length > EVIDENCE_PREVIEW && (
        <div className="show-more">
          <Button size="sm" variant="ghost" onClick={() => setShowAll((value) => !value)}>
            {showAll ? 'Show fewer claims' : `Show all ${matching.length} claims`}
          </Button>
        </div>
      )}
    </Card>
  )
}

function ContradictionsCard({ items }: { items: Contradiction[] }) {
  const openPaper = useOpenPaper()
  return (
    <Card title="Contradictions" description="Where papers pull in different directions, and why it might matter for you.">
      <ul className="contradictions">
        {items.map((x) => (
          <li key={x.id} className="contradiction">
            <div className="contradiction-pair">
              {[x.claimA, x.claimB].map(
                (c, i) =>
                  c && (
                    <Fragment key={c.id}>
                      {i === 1 && (
                        <span className="contradiction-vs" aria-hidden>
                          vs
                        </span>
                      )}
                      <div className="contradiction-side">
                        <StanceBadge stance={c.stance} />
                        <p>{c.kind === 'quote' ? `“${c.text}”` : c.text}</p>
                        {c.paper && (
                          <button type="button" className="link-sm" onClick={() => openPaper(c.paper!.id)}>
                            {shortTitle(c.paper.title)} ({c.paper.year ?? 'n.d.'})
                          </button>
                        )}
                      </div>
                    </Fragment>
                  ),
              )}
            </div>
            <p className="contradiction-explain">
              <Info aria-hidden />
              <span>{x.explanation}</span>
            </p>
          </li>
        ))}
      </ul>
    </Card>
  )
}
