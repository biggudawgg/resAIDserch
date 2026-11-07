import { Link } from 'react-router-dom'
import { Ban, FileText, RotateCcw } from 'lucide-react'
import { api } from '../api/client'
import { useApiMutation, useMemberName } from '../api/hooks'
import type { DeadEnd } from '../api/types'
import { shortTitle, timeAgo } from '../lib/format'
import { useOpenPaper } from '../lib/hooks'
import { useUI } from '../lib/ui'
import { Button } from './ui/Button'
import { DeadEndStatusBadge } from './ui/StatusBadges'

type Action = 'confirm' | 'dismiss' | 'reopen'

const DONE_MESSAGE: Record<Action, string> = {
  confirm: 'Ruled out and saved to team memory',
  dismiss: 'Proposed dead end dismissed',
  reopen: 'Dead end reopened',
}

export function DeadEndCard({ deadEnd, showQuestion = true }: { deadEnd: DeadEnd; showQuestion?: boolean }) {
  const nameOf = useMemberName()
  const openPaper = useOpenPaper()
  const { toast } = useUI()
  const action = useApiMutation((value: Action) => api.deadEndAction(deadEnd.id, value))

  const run = (value: Action) =>
    action.mutate(value, {
      onSuccess: () => toast(DONE_MESSAGE[value]),
      onError: (error) => toast(error.message, { tone: 'error' }),
    })
  const busy = (value: Action) => action.isPending && action.variables === value

  const provenance =
    deadEnd.decidedAt && deadEnd.status !== 'proposed'
      ? `${deadEnd.status === 'confirmed' ? 'Ruled out' : deadEnd.status === 'reopened' ? 'Reopened' : 'Dismissed'} by ${nameOf(deadEnd.decidedBy)} · ${timeAgo(deadEnd.decidedAt)}`
      : `Proposed by ${nameOf(deadEnd.createdBy)} · ${timeAgo(deadEnd.createdAt)}`

  return (
    <article className="deadend" id={`dead-end-${deadEnd.id}`}>
      <div className="deadend-head">
        <DeadEndStatusBadge status={deadEnd.status} />
        <span className="subtle small">{provenance}</span>
      </div>
      <h3 className="deadend-title">{deadEnd.title}</h3>
      <p className="deadend-reason">{deadEnd.reason}</p>
      {deadEnd.revisitTrigger && (
        <div className="revisit">
          <RotateCcw aria-hidden />
          <span>
            <strong>Revisit if:</strong> {deadEnd.revisitTrigger}
          </span>
        </div>
      )}
      {deadEnd.papers.length > 0 && (
        <div className="chips">
          {deadEnd.papers.map((paper) => (
            <button key={paper.id} type="button" className="chip" onClick={() => openPaper(paper.id)} title={paper.title}>
              <FileText aria-hidden />
              {shortTitle(paper.title, 32)}
            </button>
          ))}
        </div>
      )}
      {showQuestion && deadEnd.question && (
        <Link to={`/research/${deadEnd.question.id}`} className="link-sm">
          From “{deadEnd.question.question}”
        </Link>
      )}
      {deadEnd.status !== 'dismissed' && (
        <div className="deadend-actions">
          {deadEnd.status === 'proposed' && (
            <>
              <Button size="sm" variant="primary" icon={<Ban />} loading={busy('confirm')} onClick={() => run('confirm')}>
                Rule it out
              </Button>
              <Button size="sm" loading={busy('dismiss')} onClick={() => run('dismiss')}>
                Dismiss
              </Button>
            </>
          )}
          {deadEnd.status === 'confirmed' && (
            <Button size="sm" icon={<RotateCcw />} loading={busy('reopen')} onClick={() => run('reopen')}>
              Reopen
            </Button>
          )}
          {deadEnd.status === 'reopened' && (
            <Button size="sm" icon={<Ban />} loading={busy('confirm')} onClick={() => run('confirm')}>
              Rule out again
            </Button>
          )}
        </div>
      )}
    </article>
  )
}
