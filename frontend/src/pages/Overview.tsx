import { Link } from 'react-router-dom'
import { ArrowRight, Ban, FlaskConical, LibraryBig, Lightbulb, Plus, Wallet } from 'lucide-react'
import { useMemberName, useOverview, useWorkspace } from '../api/hooks'
import type { Overview as OverviewData } from '../api/types'
import { ActivityFeed } from '../components/ActivityFeed'
import { SpendBreakdown } from '../components/charts/SpendBreakdown'
import { PipelineMini } from '../components/research/Pipeline'
import { Button } from '../components/ui/Button'
import { Callout, Card } from '../components/ui/Card'
import { ConfidenceMeter } from '../components/ui/Meter'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState, ErrorState, SkeletonCard } from '../components/ui/States'
import { StatTile } from '../components/ui/StatTile'
import { formatUsd, greeting, pct, plural, timeAgo } from '../lib/format'
import { useUI } from '../lib/ui'

export function Overview() {
  const overview = useOverview()
  const workspace = useWorkspace()

  if (overview.isError) return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
  const team = workspace.data?.team

  return (
    <div className="page">
      <PageHeader title={greeting()} description={team ? `${team.name} · ${team.projectName}` : ' '} />
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
  const budgetTone = budgetShare >= 1 ? 'crit' : budgetShare >= data.spend.alertThreshold ? 'warn' : 'accent'
  const month = new Date().toLocaleDateString(undefined, { month: 'long' })

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
          The agent proposes beliefs and dead ends. Nothing enters team memory until someone approves it.
        </Callout>
      )}

      <div className="kpi-grid">
        <StatTile
          label="Active questions"
          value={data.stats.activeQuestions}
          icon={<FlaskConical />}
          to="/research"
          sub={`${data.stats.running} running · ${data.stats.needsReview} need review`}
        />
        <StatTile
          label="Team beliefs"
          value={data.stats.activeBeliefs}
          icon={<Lightbulb />}
          to="/beliefs"
          sub={`Average confidence ${pct(data.stats.avgConfidence)}`}
        />
        <StatTile
          label="Papers in library"
          value={data.stats.papers}
          icon={<LibraryBig />}
          to="/library"
          sub={`${data.stats.papersThisWeek} added this week`}
        />
        <StatTile
          label="Spend this month"
          value={formatUsd(data.spend.monthToDate)}
          icon={<Wallet />}
          to="/providers"
          sub={`${pct(budgetShare)} of the ${formatUsd(data.spend.budget)} budget`}
          meter={{ value: budgetShare, tone: budgetTone, label: 'Monthly budget used' }}
        />
      </div>

      <div className="overview-grid">
        <div className="stack">
          <Card
            title="Research in progress"
            actions={
              <Link className="link" to="/research">
                All research
              </Link>
            }
          >
            {data.running.length === 0 ? (
              <EmptyState
                compact
                icon={<FlaskConical />}
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
                      {q.run && <PipelineMini run={q.run} />}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Needs your review" description="Drafts from the research agent waiting for a human decision.">
            {reviewCount === 0 ? (
              <EmptyState compact title="You're all caught up" description="New drafts appear here when a research run finishes." />
            ) : (
              <ul className="list">
                {data.review.beliefs.map((b) => (
                  <li key={b.id}>
                    <Link to={b.questionId ? `/research/${b.questionId}` : `/beliefs?focus=${b.id}`} className="list-row list-row-split">
                      <span className="list-main">
                        <span className="list-kicker">
                          <Lightbulb aria-hidden /> Draft belief
                        </span>
                        <span className="list-title">{b.statement}</span>
                        {b.question && <span className="list-meta">From “{b.question.question}”</span>}
                      </span>
                      <span className="list-side">
                        <ConfidenceMeter value={b.confidence} variant="inline" />
                      </span>
                    </Link>
                  </li>
                ))}
                {data.review.deadEnds.map((d) => (
                  <li key={d.id}>
                    <Link to={d.questionId ? `/research/${d.questionId}` : `/dead-ends?focus=${d.id}`} className="list-row list-row-split">
                      <span className="list-main">
                        <span className="list-kicker">
                          <Ban aria-hidden /> Proposed dead end
                        </span>
                        <span className="list-title">{d.title}</span>
                        <span className="list-meta clamp-2">{d.reason}</span>
                      </span>
                      <span className="list-side">
                        <ArrowRight className="list-chevron" aria-hidden />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Strongest beliefs"
            actions={
              <Link className="link" to="/beliefs">
                All beliefs
              </Link>
            }
          >
            <ul className="list">
              {data.topBeliefs.map((b) => (
                <li key={b.id}>
                  <Link to={`/beliefs?focus=${b.id}`} className="list-row list-row-split">
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
          </Card>
        </div>

        <div className="stack">
          <Card
            title="Spend by provider"
            description={`${month} to date`}
            actions={
              <Link className="link" to="/providers">
                Usage
              </Link>
            }
          >
            <SpendBreakdown items={data.spend.byProvider} />
          </Card>
          <Card title="Recent activity">
            <ActivityFeed items={data.activity} />
          </Card>
        </div>
      </div>
    </>
  )
}
