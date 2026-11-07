export type ProviderId = 'claude' | 'openai' | 'groq' | 'custom'
export type QuestionStatus = 'running' | 'needs_review' | 'answered' | 'failed' | 'archived' | 'open'
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled'
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'
export type Executor = 'llm' | 'heuristic' | 'arxiv' | 'local' | 'sample'
export type Stance = 'supports' | 'limits' | 'neutral'
export type BeliefStatus = 'proposed' | 'active' | 'rejected' | 'archived'
export type DeadEndStatus = 'proposed' | 'confirmed' | 'dismissed' | 'reopened'
export type MeetingStanceValue = 'agree' | 'disagree' | 'conditional' | 'unsure'
export type Role = 'lead' | 'researcher' | 'engineer' | 'viewer'
export type ProviderStatus = 'not_configured' | 'untested' | 'connected' | 'error'
export type Priority = 'quality' | 'balanced' | 'speed' | 'cost'

export interface Member {
  id: string
  name: string
  email: string
  role: Role
  joinedAt: string
}

export interface WorkspaceSettings {
  monthlyBudgetUsd: number
  alertThreshold: number
  maxPapers: number
  backgroundWatch: boolean
  groqFreeTier: boolean
  retentionMonths: number
}

export interface Workspace {
  team: { name: string; projectName: string; projectEndDate: string | null; createdAt: string }
  settings: WorkspaceSettings
  retentionDeleteOn: string | null
  members: Member[]
  currentUserId: string
  demo: boolean
  providers: { id: ProviderId; short: string; status: ProviderStatus }[]
}

export interface QuestionRef {
  id: string
  question: string
}

export interface PaperBrief {
  id: string
  arxivId: string | null
  title: string
  authors: string[]
  etAl: boolean
  year: number | null
  url: string | null
}

export interface Paper extends PaperBrief {
  published: string | null
  source: string
  pdfUrl: string | null
  summary: string
  summaryKind: 'abstract' | 'note'
  addedAt: string
  addedBy: string
  claimCount: number
  beliefCount: number
  questionIds: string[]
}

export interface Claim {
  id: string
  paperId: string
  questionId: string
  text: string
  kind: 'quote' | 'summary'
  stance: Stance
  paper: PaperBrief | null
}

export interface BeliefHistoryEntry {
  at: string
  confidence: number
  event: string
  by: string
}

export interface Belief {
  id: string
  statement: string
  confidence: number
  status: BeliefStatus
  questionId: string | null
  sources: string[]
  evidence: string
  createdAt: string
  updatedAt: string
  approvedBy: string | null
  approvedAt: string | null
  history: BeliefHistoryEntry[]
  question: QuestionRef | null
  sourcePapers: PaperBrief[]
}

export interface PaperDetail extends Paper {
  claims: Array<Claim & { question: QuestionRef | null }>
  beliefs: Belief[]
}

export interface DeadEnd {
  id: string
  title: string
  reason: string
  revisitTrigger: string | null
  status: DeadEndStatus
  questionId: string | null
  relatedPapers: string[]
  createdAt: string
  createdBy: string
  decidedBy: string | null
  decidedAt: string | null
  question: QuestionRef | null
  papers: PaperBrief[]
}

export interface RunStep {
  key: string
  task: string | null
  label: string
  short: string
  description: string
  status: StepStatus
  startedAt: string | null
  finishedAt: string | null
  routedTo: ProviderId | null
  model: string | null
  routeReason: string | null
  executor: Executor | null
  inputTokens: number
  outputTokens: number
  costUsd: number
  detail: string | null
  fallbackFrom: ProviderId | null
  durationMs: number | null
}

export interface RunSummary {
  id: string
  status: RunStatus
  startedAt: string
  finishedAt: string | null
  origin: 'sample' | 'demo' | 'live'
  forcedProvider: ProviderId | null
  error: string | null
  progress: number
  currentStep: number | null
  currentLabel: string | null
  currentProvider: ProviderId | null
}

export interface RunDetail extends RunSummary {
  steps: RunStep[]
  totals: { costUsd: number; inputTokens: number; outputTokens: number; durationMs: number }
}

export interface QuestionSummary {
  id: string
  question: string
  context: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  lastRunAt: string | null
  archived: boolean
  status: QuestionStatus
  papersAnalyzed: number
  confidence: number | null
  beliefId: string | null
  beliefStatus: BeliefStatus | null
  pendingReview: number
  run: RunSummary | null
}

export interface Contradiction {
  id: string
  explanation: string
  severity: 'tension' | 'conflict'
  claimA: Claim | null
  claimB: Claim | null
}

export interface Findings {
  runId: string
  synthesis: string
  confidence: { score: number; supporting: number; limiting: number; neutral: number; rationale: string }
  screened: number
  claims: Claim[]
  contradictions: Contradiction[]
  papers: PaperBrief[]
}

export interface QuestionDetail extends Omit<QuestionSummary, 'run'> {
  run: RunDetail | null
  findings: Findings | null
  belief: Belief | null
  deadEnds: DeadEnd[]
  runs: RunDetail[]
}

export type LinkType = 'question' | 'belief' | 'dead_end' | 'paper' | 'meeting'

export interface Activity {
  id: string
  at: string
  kind: string
  actor: string
  text: string
  link: { type: LinkType; id: string } | null
}

export interface ProviderSpend {
  provider: ProviderId
  costUsd: number
  calls: number
}

export interface Overview {
  stats: {
    activeQuestions: number
    running: number
    needsReview: number
    activeBeliefs: number
    avgConfidence: number
    papers: number
    papersThisWeek: number
    deadEnds: number
  }
  running: QuestionSummary[]
  review: { beliefs: Belief[]; deadEnds: DeadEnd[] }
  topBeliefs: Belief[]
  spend: { monthToDate: number; budget: number; alertThreshold: number; byProvider: ProviderSpend[] }
  activity: Activity[]
}

export interface MeetingStance {
  id: string
  memberId: string | null
  speaker: string
  topic: string
  stance: MeetingStanceValue
  quote: string
  verified: boolean
}

export interface MeetingSummary {
  id: string
  title: string
  date: string
  createdAt: string
  topics: string[]
  extractedBy: string
  origin: string
  participants: string[]
  unknownSpeakers: string[]
  stanceCount: number
  verifiedCount: number
}

export interface Meeting extends MeetingSummary {
  transcript: string
  stances: MeetingStance[]
}

export interface Provider {
  id: ProviderId
  name: string
  short: string
  blurb: string
  consoleUrl: string | null
  keyPlaceholder: string
  models: string[]
  model: string
  baseUrl: string
  enabled: boolean
  status: ProviderStatus
  hasKey: boolean
  keyHint: string | null
  lastTestedAt: string | null
  lastTestMessage: string | null
  lastLatencyMs: number | null
  month: { costUsd: number; calls: number; tokens: number; avgLatencyMs: number | null; fallbacks: number }
}

export interface ProviderTestResult {
  ok: boolean
  message: string
  latencyMs: number
  provider: Provider
}

export interface RoutingRule {
  task: string
  label: string
  description: string
  primary: ProviderId
  fallback: ProviderId | null
  reason: string
}

export interface Routing {
  priority: Priority
  autoFallback: boolean
  allowOverride: boolean
  rules: RoutingRule[]
}

export interface UsageDay {
  date: string
  costUsd: number
  byProvider: Record<ProviderId, number>
  calls: number
}

export interface Usage {
  days: number
  daily: UsageDay[]
  byProvider: Array<{
    provider: ProviderId
    costUsd: number
    calls: number
    inputTokens: number
    outputTokens: number
    avgLatencyMs: number | null
    fallbacks: number
  }>
  byTask: Array<{ task: string; label: string; calls: number; costUsd: number }>
  totals: { costUsd: number; calls: number; tokens: number; fallbacks: number; demoCalls: number }
}

export interface TaskLog {
  id: string
  at: string
  task: string
  label: string
  provider: ProviderId | 'demo'
  routedTo: ProviderId | null
  model: string | null
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number
  status: 'ok' | 'fallback' | 'failed'
  fallbackFrom: ProviderId | null
  questionId: string | null
  mode: 'sample' | 'demo' | 'live'
  reason: string | null
}

export interface SearchResult {
  type: LinkType
  id: string
  title: string
  subtitle: string
}
