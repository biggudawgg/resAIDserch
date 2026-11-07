import { Link, useSearchParams } from 'react-router-dom'
import { ExternalLink, FileText } from 'lucide-react'
import { useMemberName, usePaper } from '../../api/hooks'
import { formatAuthors, timeAgo } from '../../lib/format'
import { Badge } from '../ui/Badge'
import { ConfidenceMeter } from '../ui/Meter'
import { Drawer } from '../ui/Modal'
import { EmptyState, SkeletonCard } from '../ui/States'
import { BeliefStatusBadge, StanceBadge } from '../ui/StatusBadges'

export function PaperDrawer() {
  const [params, setParams] = useSearchParams()
  const id = params.get('paper')
  const paper = usePaper(id)
  const nameOf = useMemberName()
  const p = paper.data

  const close = () => {
    const next = new URLSearchParams(params)
    next.delete('paper')
    setParams(next, { replace: true })
  }

  return (
    <Drawer open={Boolean(id)} onClose={close} title="Paper">
      {paper.isError ? (
        <EmptyState title="Paper not found" description="It may have been removed from the library." />
      ) : !p ? (
        <SkeletonCard lines={6} />
      ) : (
        <div className="paper-detail">
          <h3 className="paper-title">{p.title}</h3>
          <p className="paper-authors">
            {formatAuthors(p.authors, p.etAl)} · {p.year ?? 'n.d.'}
          </p>
          <div className="paper-links">
            {p.url && (
              <a className="btn btn-secondary btn-sm" href={p.url} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden />
                arXiv page
              </a>
            )}
            {p.pdfUrl && (
              <a className="btn btn-secondary btn-sm" href={p.pdfUrl} target="_blank" rel="noreferrer">
                <FileText aria-hidden />
                PDF
              </a>
            )}
            {p.arxivId && <Badge>arXiv:{p.arxivId}</Badge>}
          </div>

          <section className="drawer-section">
            <h4>{p.summaryKind === 'abstract' ? 'Abstract' : 'Team summary'}</h4>
            <p className="paper-summary">{p.summary}</p>
            {p.summaryKind === 'note' && <p className="field-hint">Written by the team. Open the arXiv page for the original abstract.</p>}
          </section>

          <section className="drawer-section">
            <h4>Claims extracted ({p.claims.length})</h4>
            {p.claims.length === 0 ? (
              <p className="muted">No claims extracted from this paper yet.</p>
            ) : (
              <ul className="drawer-list">
                {p.claims.map((c) => (
                  <li key={c.id}>
                    <StanceBadge stance={c.stance} />
                    <p className="claim-text-sm">{c.kind === 'quote' ? `“${c.text}”` : c.text}</p>
                    {c.question && (
                      <Link className="link-sm" to={`/research/${c.question.id}`} onClick={close}>
                        {c.question.question}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="drawer-section">
            <h4>Beliefs citing this paper ({p.beliefs.length})</h4>
            {p.beliefs.length === 0 ? (
              <p className="muted">Not cited by any active belief.</p>
            ) : (
              <ul className="drawer-list">
                {p.beliefs.map((b) => (
                  <li key={b.id}>
                    <div className="drawer-belief-head">
                      <BeliefStatusBadge status={b.status} />
                    </div>
                    <Link className="drawer-belief" to={`/beliefs?focus=${b.id}`} onClick={close}>
                      {b.statement}
                    </Link>
                    <ConfidenceMeter value={b.confidence} variant="inline" />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="field-hint">
            Added {timeAgo(p.addedAt)} by {nameOf(p.addedBy)}
          </p>
        </div>
      )}
    </Drawer>
  )
}
