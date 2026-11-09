import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { api } from '../../api/client'
import { useDialog } from '../ui/Modal'
import { Button } from '../ui/Button'
import { markDemoSplashSeen } from '../../lib/demoSplash'
import { Wordmark } from './Wordmark'

const POINTS = [
  {
    title: 'The data is made up.',
    body: 'The team, questions, beliefs, meetings and spend figures exist to show how the product works.',
  },
  {
    title: 'Paper search is real.',
    body: 'New questions search arXiv for real papers. Claim extraction, confidence and briefings use simple heuristics here, not a language model.',
  },
  {
    title: 'Everything is shared and temporary.',
    body: 'Other visitors see what you add, and it is wiped when the server restarts. Don’t enter anything private.',
  },
]

function ServerStatus() {
  // Cloud Run scales to zero, so the first request after idle can take a few seconds. This also wakes it.
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: 3, staleTime: 60_000 })
  if (health.isSuccess)
    return (
      <p className="splash-status splash-status-ok" role="status">
        <CheckCircle2 aria-hidden /> Demo server is ready
      </p>
    )
  if (health.isError)
    return (
      <p className="splash-status splash-status-error" role="status">
        <XCircle aria-hidden /> Can’t reach the demo server right now. Try again in a minute.
      </p>
    )
  return (
    <p className="splash-status" role="status">
      <Loader2 className="spin" aria-hidden /> Waking up the demo server… this can take a few seconds.
    </p>
  )
}

export function DemoSplash({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const close = () => {
    markDemoSplashSeen()
    onClose()
  }
  useDialog(open, close, ref)
  if (!open) return null

  return createPortal(
    <div className="overlay splash-overlay">
      <div ref={ref} className="modal splash" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="splash-hero">
          <span className="splash-tag">Live demo</span>
          <h2 id={titleId} className="splash-title">
            <Wordmark size={34} />
          </h2>
          <p className="splash-lead">
            Research notes for engineering teams. Ask a question, get the relevant papers read and summarised with quotes, and
            decide as a team what you now believe.
          </p>
        </div>
        <ol className="splash-points">
          {POINTS.map(({ title, body }) => (
            <li key={title} className="splash-point">
              <p className="splash-point-title">{title}</p>
              <p className="splash-point-body">{body}</p>
            </li>
          ))}
        </ol>
        <footer className="splash-footer">
          <ServerStatus />
          <Button variant="primary" iconRight={<ArrowRight />} onClick={close} data-autofocus>
            Explore the demo
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
