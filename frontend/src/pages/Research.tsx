import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, FlaskConical, Plus, Search } from 'lucide-react'
import { useMemberName, useQuestions } from '../api/hooks'
import type { QuestionSummary } from '../api/types'
import { PipelineMini } from '../components/research/Pipeline'
import { Avatar } from '../components/ui/Avatar'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { FilterTabs } from '../components/ui/Field'
import { ConfidenceMeter } from '../components/ui/Meter'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState, ErrorState, SkeletonCard } from '../components/ui/States'
import { QuestionStatusBadge } from '../components/ui/StatusBadges'
import { plural, timeAgo } from '../lib/format'
import { useUI } from '../lib/ui'

type Filter = 'all' | 'in_progress' | 'needs_review' | 'answered' | 'archived'

function matches(q: QuestionSummary, filter: Filter): boolean {
  switch (filter) {
    case 'all':
      return q.status !== 'archived'
    case 'in_progress':
      return q.status === 'running' || q.status === 'failed' || q.status === 'open'
    default:
      return q.status === filter
  }
}

function QuestionRow({ q, author }: { q: QuestionSummary; author: string }) {
  return (
    <Link to={`/research/${q.id}`} className="qrow">
      <div className="qrow-main">
        <div className="qrow-top">
          <QuestionStatusBadge status={q.status} />
          {q.pendingReview > 0 && q.status !== 'needs_review' && <Badge tone="warn">{q.pendingReview} to review</Badge>}
        </div>
        <h3 className="qrow-title">{q.question}</h3>
        {q.context && <p className="qrow-context">{q.context}</p>}
        {q.status === 'running' && q.run ? (
          <PipelineMini run={q.run} />
        ) : (
          <p className="qrow-meta">
            <Avatar name={author} size="xs" />
            <span>{author}</span>
            <span aria-hidden>·</span>
            <span>asked {timeAgo(q.createdAt)}</span>
            {q.lastRunAt && (
              <>
                <span aria-hidden>·</span>
                <span>last run {timeAgo(q.lastRunAt)}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{plural(q.papersAnalyzed, 'paper')}</span>
          </p>
        )}
      </div>
      <div className="qrow-side">
        {q.confidence !== null ? (
          <div className="qrow-conf">
            <span className="qrow-conf-label">{q.beliefStatus === 'proposed' ? 'Draft confidence' : 'Confidence'}</span>
            <ConfidenceMeter value={q.confidence} variant="inline" />
          </div>
        ) : (
          <span className="subtle small">{q.status === 'running' ? 'Belief pending' : 'No belief'}</span>
        )}
        <ChevronRight className="qrow-chevron" aria-hidden />
      </div>
    </Link>
  )
}

export function Research() {
  const questions = useQuestions()
  const nameOf = useMemberName()
  const { openAsk } = useUI()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  if (questions.isError) return <ErrorState error={questions.error} onRetry={() => questions.refetch()} />

  const all = questions.data ?? []
  const needle = query.trim().toLowerCase()
  const visible = all.filter(
    (q) => matches(q, filter) && (!needle || `${q.question} ${q.context ?? ''}`.toLowerCase().includes(needle)),
  )
  const count = (f: Filter) => all.filter((q) => matches(q, f)).length

  return (
    <div className="page">
      <PageHeader
        title="Research"
        description="Questions the agent investigates for your team. Each run searches papers, extracts claims with quotes, and drafts a belief for review."
      />

      <div className="toolbar">
        <FilterTabs
          label="Filter questions by status"
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: 'All', count: count('all') },
            { value: 'in_progress', label: 'In progress', count: count('in_progress') },
            { value: 'needs_review', label: 'Needs review', count: count('needs_review') },
            { value: 'answered', label: 'Answered', count: count('answered') },
            { value: 'archived', label: 'Archived', count: count('archived') },
          ]}
        />
        <label className="search-input">
          <Search aria-hidden />
          <input
            className="input"
            type="search"
            placeholder="Filter by text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Filter questions by text"
          />
        </label>
      </div>

      {!questions.data ? (
        <div className="qlist">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<FlaskConical />}
          title={needle ? 'No questions match that text' : 'No questions here yet'}
          description={needle ? 'Try a different word, or clear the filter.' : 'Ask a question to start your first research run.'}
          action={
            !needle && (
              <Button variant="primary" icon={<Plus />} onClick={openAsk}>
                Ask question
              </Button>
            )
          }
        />
      ) : (
        <ul className="qlist">
          {visible.map((q) => (
            <li key={q.id}>
              <QuestionRow q={q} author={nameOf(q.createdBy)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
