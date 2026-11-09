import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CheckCircle2, FlaskRound, Loader2, Search, Users, XCircle } from 'lucide-react'
import { api } from '../../api/client'
import { useDialog } from '../ui/Modal'
import { Button } from '../ui/Button'
import { markDemoSplashSeen } from '../../lib/demoSplash'
import { Logo } from './Logo'

const POINTS = [
  {
    icon: FlaskRound,
    title: 'Sample data',
    body: 'The team, questions, beliefs, meetings and spend figures are made up to show how the product works.',
  },
  {
    icon: Search,
    title: 'Real paper search, simplified analysis',
    body: 'New research runs search arXiv for real papers. Claim extraction, confidence and briefings use simple heuristics, not a live LLM.',
  },
  {
    icon: Users,
    title: 'Shared and temporary',
    body: 'Anything you add is visible to other visitors and is wiped when the server restarts. Please don’t enter private information.',
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
          <Logo size={44} />
          <span className="splash-tag">
            <FlaskRound aria-hidden /> Live demo
          </span>
          <h2 id={titleId} className="splash-title">
            Welcome to resAIDserch
          </h2>
          <p className="splash-lead">
            A shared research memory for engineering teams: an agent reads papers, drafts beliefs with evidence, and your team
            reviews them before they count.
          </p>
        </div>
        <ul className="splash-points">
          {POINTS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="splash-point">
              <span className="splash-point-icon">
                <Icon aria-hidden />
              </span>
              <div>
                <p className="splash-point-title">{title}</p>
                <p className="splash-point-body">{body}</p>
              </div>
            </li>
          ))}
        </ul>
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
