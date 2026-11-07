import type { ReactNode } from 'react'
import {
  AlertTriangle,
  Archive,
  Ban,
  CheckCircle2,
  Circle,
  CircleDashed,
  Eye,
  GitBranch,
  HelpCircle,
  KeyRound,
  Loader2,
  Minus,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from 'lucide-react'
import type {
  BeliefStatus,
  DeadEndStatus,
  MeetingStanceValue,
  ProviderStatus,
  QuestionStatus,
  Stance,
} from '../../api/types'
import { Badge, type Tone } from './Badge'

interface Spec {
  tone: Tone
  label: string
  icon: ReactNode
}

const QUESTION: Record<QuestionStatus, Spec> = {
  running: { tone: 'info', label: 'Researching', icon: <Loader2 className="spin" aria-hidden /> },
  needs_review: { tone: 'warn', label: 'Needs review', icon: <Eye aria-hidden /> },
  answered: { tone: 'good', label: 'Answered', icon: <CheckCircle2 aria-hidden /> },
  failed: { tone: 'crit', label: 'Failed', icon: <XCircle aria-hidden /> },
  archived: { tone: 'neutral', label: 'Archived', icon: <Archive aria-hidden /> },
  open: { tone: 'neutral', label: 'Open', icon: <Circle aria-hidden /> },
}

const BELIEF: Record<BeliefStatus, Spec> = {
  proposed: { tone: 'warn', label: 'Needs review', icon: <Eye aria-hidden /> },
  active: { tone: 'good', label: 'Active', icon: <CheckCircle2 aria-hidden /> },
  rejected: { tone: 'crit', label: 'Rejected', icon: <XCircle aria-hidden /> },
  archived: { tone: 'neutral', label: 'Archived', icon: <Archive aria-hidden /> },
}

const DEAD_END: Record<DeadEndStatus, Spec> = {
  proposed: { tone: 'warn', label: 'Proposed', icon: <Eye aria-hidden /> },
  confirmed: { tone: 'crit', label: 'Ruled out', icon: <Ban aria-hidden /> },
  dismissed: { tone: 'neutral', label: 'Dismissed', icon: <CircleDashed aria-hidden /> },
  reopened: { tone: 'info', label: 'Reopened', icon: <RotateCcw aria-hidden /> },
}

const STANCE: Record<Stance, Spec> = {
  supports: { tone: 'good', label: 'Supports', icon: <ThumbsUp aria-hidden /> },
  limits: { tone: 'warn', label: 'Limits', icon: <AlertTriangle aria-hidden /> },
  neutral: { tone: 'neutral', label: 'Context', icon: <Minus aria-hidden /> },
}

const MEETING_STANCE: Record<MeetingStanceValue, Spec> = {
  agree: { tone: 'good', label: 'Agrees', icon: <ThumbsUp aria-hidden /> },
  disagree: { tone: 'crit', label: 'Disagrees', icon: <ThumbsDown aria-hidden /> },
  conditional: { tone: 'warn', label: 'Conditional', icon: <GitBranch aria-hidden /> },
  unsure: { tone: 'neutral', label: 'Unsure', icon: <HelpCircle aria-hidden /> },
}

const PROVIDER: Record<ProviderStatus, Spec> = {
  connected: { tone: 'good', label: 'Connected', icon: <CheckCircle2 aria-hidden /> },
  untested: { tone: 'warn', label: 'Key saved, untested', icon: <KeyRound aria-hidden /> },
  error: { tone: 'crit', label: 'Connection failed', icon: <XCircle aria-hidden /> },
  not_configured: { tone: 'neutral', label: 'Not connected', icon: <CircleDashed aria-hidden /> },
}

function render(spec: Spec) {
  return (
    <Badge tone={spec.tone} icon={spec.icon}>
      {spec.label}
    </Badge>
  )
}

export const QuestionStatusBadge = ({ status }: { status: QuestionStatus }) => render(QUESTION[status])
export const BeliefStatusBadge = ({ status }: { status: BeliefStatus }) => render(BELIEF[status])
export const DeadEndStatusBadge = ({ status }: { status: DeadEndStatus }) => render(DEAD_END[status])
export const StanceBadge = ({ stance }: { stance: Stance }) => render(STANCE[stance])
export const MeetingStanceBadge = ({ stance }: { stance: MeetingStanceValue }) => render(MEETING_STANCE[stance])
export const ProviderStatusBadge = ({ status }: { status: ProviderStatus }) => render(PROVIDER[status])

export const MEETING_STANCE_LABEL: Record<MeetingStanceValue, string> = {
  agree: 'Agrees',
  disagree: 'Disagrees',
  conditional: 'Conditional',
  unsure: 'Unsure',
}
