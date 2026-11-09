import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ClipboardCheck, FlaskConical, History, Lightbulb, Plus, Wallet } from 'lucide-react'
import { useMemberName, useOverview, useWorkspace } from '../api/hooks'
import type { Overview as OverviewData } from '../api/types'
import { ActivityFeed } from '../components/ActivityFeed'
import { SpendByTask } from '../components/charts/SpendByTask'
import { PipelineMini } from '../components/research/Pipeline'
import { ReviewDeck } from '../components/research/ReviewDeck'
import { Button } from '../components/ui/Button'
import { Callout } from '../components/ui/Card'
import { ConfidenceMeter } from '../components/ui/Meter'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState, ErrorState, SkeletonCard } from '../components/ui/States'
import { StatTile } from '../components/ui/StatTile'
import { WidgetGrid, type WidgetGridItem, type WidgetLayoutItem } from '../components/ui/WidgetGrid'
import { cx } from '../lib/cx'
import { formatUsd, pct, plural, timeAgo } from '../lib/format'
import { useUI } from '../lib/ui'

/** This browser's arrangement of the overview widgets; cleared by "Reset my preferences" in the profile menu. */
const OVERVIEW_LAYOUT_KEY = 'resaidserch.overview-layout'

const DEFAULT_LAYOUT: WidgetLayoutItem[] = [
  { id: 'research', span: 4 },
  { id: 'spending', span: 2 },
  { id: 'review', span: 4 },
  { id: 'activity', span: 2 },
  { id: 'beliefs', span: 6 },
]

function readLayout(): WidgetLayoutItem[] {
  try {
    const raw = localStorage.getItem(OVERVIEW_LAYOUT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed) && parsed.every((e) => typeof e?.id === 'string' && typeof e?.span === 'number')) {
      return parsed as WidgetLayoutItem[]
    }
  } catch {
    // Unreadable or blocked storage: fall back to the default.
  }
  return DEFAULT_LAYOUT
}

const sameLayout = (a: WidgetLayoutItem[], b: WidgetLayoutItem[]) =>
  a.length === b.length && a.every((e, i) => e.id === b[i].id && e.span === b[i].span)

function useOverviewLayout() {
  const [layout, setState] = useState(readLayout)
  const setLayout = useCallback((next: WidgetLayoutItem[]) => {
    setState(next)
    try {
      if (sameLayout(next, DEFAULT_LAYOUT)) localStorage.removeItem(OVERVIEW_LAYOUT_KEY)
      else localStorage.setItem(OVERVIEW_LAYOUT_KEY, JSON.stringify(next))
    } catch {
      // Storage blocked: the layout still applies for this visit.
    }
  }, [])
  const resetLayout = useCallback(() => setLayout(DEFAULT_LAYOUT), [setLayout])
  // "Reset my preferences" in the profile menu clears the stored layout; follow it while this page is open.
  useEffect(() => {
    const reset = () => setState(DEFAULT_LAYOUT)
    window.addEventListener('resaidserch:layout-reset', reset)
    return () => window.removeEventListener('resaidserch:layout-reset', reset)
  }, [])
  return { layout, setLayout, resetLayout, customised: !sameLayout(layout, DEFAULT_LAYOUT) }
}

export function Overview() {
  const overview = useOverview()
  const workspace = useWorkspace()

  if (overview.isError) return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
  const team = workspace.data?.team

  return (
    <div className="page">
      <PageHeader title={team?.name ?? 'Overview'} description={team ? team.projectName : ' '} />
      {overview.data ? (
        <OverviewBody data={overview.data} />
      ) : (
        <div className="kpi-grid">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
      )}
    </div>
  )
}

function OverviewBody({ data }: { data: OverviewData }) {
  const nameOf = useMemberName()
  const { openAsk } = useUI()
  const reviewCount = data.review.beliefs.length + data.review.deadEnds.length
  const firstReview = data.review.beliefs[0]?.questionId ?? data.review.deadEnds[0]?.questionId
  const budgetShare = data.spend.budget > 0 ? data.spend.monthToDate / data.spend.budget : 0
  const { layout, setLayout, resetLayout, customised } = useOverviewLayout()

  const widgets: WidgetGridItem[] = [
    {
      id: 'research',
      title: 'Research in progress',
      icon: <FlaskConical />,
      tone: 'tone-teal',
      rows: 2,
      actions: (
        <Link className="link" to="/research">
          All research
        </Link>
      ),
      render: (size) =>
        data.running.length === 0 ? (
          <EmptyState
            compact
            title="Nothing running right now"
            description="Ask a question and the agent will search, read and summarise the literature."
            action={
              <Button size="sm" icon={<Plus />} onClick={openAsk}>
                Ask question
              </Button>
            }
          />
        ) : (
          <ul className="list">
            {data.running.map((q) => (
              <li key={q.id}>
                <Link to={`/research/${q.id}`} className="list-row list-row-stack">
                  <span className="list-title">{q.question}</span>
                  <span className="list-meta">
                    Asked by {nameOf(q.createdBy)} · {timeAgo(q.createdAt)}
                  </span>
                  {q.run && size !== 's' && <PipelineMini run={q.run} />}
                </Link>
              </li>
            ))}
          </ul>
        ),
    },
    {
      id: 'spending',
      title: 'Spending',
      description: 'By task, last 30 days',
      icon: <Wallet />,
      tone: 'tone-amber',
      rows: 2,
      actions: (
        <Link className="link" to="/providers">
          Usage
        </Link>
      ),
      render: () => <SpendByTask />,
    },
    {
      id: 'review',
      title: 'Needs your review',
      description: 'Drafts waiting for a human decision',
      icon: <ClipboardCheck />,
      tone: 'tone-orange',
      rows: 2,
      // The deck has its own swipe gesture, so a long press there must not lift the tile.
      render: () =>
        reviewCount === 0 ? (
          <EmptyState compact title="You're all caught up" description="New drafts appear here when a research run finishes." />
        ) : (
          <div data-no-press>
            <ReviewDeck beliefs={data.review.beliefs} deadEnds={data.review.deadEnds} />
          </div>
        ),
    },
    {
      id: 'activity',
      title: 'Recent activity',
      icon: <History />,
      tone: 'tone-violet',
      rows: 2,
      render: () => <ActivityFeed items={data.activity} />,
    },
    {
      id: 'beliefs',
      title: 'Strongest beliefs',
      icon: <Lightbulb />,
      tone: 'tone-green',
      rows: 2,
      actions: (
        <Link className="link" to="/beliefs">
          All beliefs
        </Link>
      ),
      render: (size) => (
        <ul className="list">
          {data.topBeliefs.map((b) => (
            <li key={b.id}>
              <Link to={`/beliefs?focus=${b.id}`} className={cx('list-row', size === 's' ? 'list-row-stack' : 'list-row-split')}>
                <span className="list-main">
                  <span className="list-title">{b.statement}</span>
                  <span className="list-meta">
                    {plural(b.sourcePapers.length, 'source')} · updated {timeAgo(b.updatedAt)}
                  </span>
                </span>
                <span className="list-side">
                  <ConfidenceMeter value={b.confidence} variant="inline" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ),
    },
  ]

  return (
    <>
      {reviewCount > 0 && (
        <Callout
          tone="warn"
          title={`${plural(reviewCount, 'draft')} waiting for your review`}
          action={
            <Link className="btn btn-secondary btn-sm" to={firstReview ? `/research/${firstReview}` : '/beliefs'}>
              Review now <ArrowRight aria-hidden />
            </Link>
          }
        >
          Nothing becomes a team belief until someone approves it.
        </Callout>
      )}

      <div className="kpi-grid">
        <StatTile
          label="Active questions"
          value={data.stats.activeQuestions}
          to="/research"
          sub={`${data.stats.running} running · ${data.stats.needsReview} need review`}
        />
        <StatTile
          label="Team beliefs"
          value={data.stats.activeBeliefs}
          to="/beliefs"
          sub={`Average confidence ${pct(data.stats.avgConfidence)}`}
        />
        <StatTile
          label="Papers in library"
          value={data.stats.papers}
          to="/library"
          sub={`${data.stats.papersThisWeek} added this week`}
        />
        <StatTile
          label="Spend this month"
          value={formatUsd(data.spend.monthToDate)}
          to="/providers"
          sub={`${pct(budgetShare)} of the ${formatUsd(data.spend.budget)} budget`}
        />
      </div>

      <WidgetGrid
        items={widgets}
        label="Overview widgets"
        layout={layout}
        onLayoutChange={setLayout}
      />
      {customised && (
        <p className="wgrid-note">
          You rearranged this page.{' '}
          <button className="link" onClick={resetLayout} type="button">
            Restore the default layout
          </button>
        </p>
      )}
    </>
  )
}
