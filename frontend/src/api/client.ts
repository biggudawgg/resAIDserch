import type {
  Belief,
  DeadEnd,
  Meeting,
  MeetingStanceValue,
  MeetingSummary,
  Member,
  Overview,
  Paper,
  PaperDetail,
  Priority,
  Provider,
  ProviderId,
  ProviderTestResult,
  QuestionDetail,
  QuestionSummary,
  Role,
  Routing,
  SearchResult,
  TaskLog,
  Usage,
  Workspace,
} from './types'

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new ApiError("Can't reach the Hindsight API. Start it with: python demo_server.py", 0)
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = await response.json()
      if (typeof body?.detail === 'string') message = body.detail
      else if (Array.isArray(body?.detail)) message = body.detail.map((d: { msg: string }) => d.msg).join('; ')
    } catch {
      /* non-JSON error body: keep the status message */
    }
    throw new ApiError(message, response.status)
  }
  if (response.status === 204) return undefined as T
  const type = response.headers.get('content-type') ?? ''
  return (type.includes('application/json') ? response.json() : response.text()) as Promise<T>
}

const get = <T>(path: string) => request<T>(path)
const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  workspace: () => get<Workspace>('/workspace'),
  overview: () => get<Overview>('/overview'),

  questions: () => get<QuestionSummary[]>('/questions'),
  question: (id: string) => get<QuestionDetail>(`/questions/${id}`),
  ask: (body: { question: string; context?: string; provider?: ProviderId | null }) =>
    send<QuestionDetail>('POST', '/questions', body),
  rerun: (id: string, provider: ProviderId | null) => send<QuestionDetail>('POST', `/questions/${id}/runs`, { provider }),
  updateQuestion: (id: string, body: { question?: string; context?: string; archived?: boolean }) =>
    send<QuestionDetail>('PATCH', `/questions/${id}`, body),
  deleteQuestion: (id: string) => send<void>('DELETE', `/questions/${id}`),
  briefingUrl: (id: string) => `${BASE}/questions/${id}/briefing.md`,
  briefing: (id: string) => get<string>(`/questions/${id}/briefing.md`),

  beliefs: () => get<Belief[]>('/beliefs'),
  approveBelief: (id: string, statement?: string) => send<Belief>('POST', `/beliefs/${id}/approve`, { statement }),
  rejectBelief: (id: string, reason?: string) => send<Belief>('POST', `/beliefs/${id}/reject`, { reason }),
  updateBelief: (id: string, body: { statement?: string; status?: 'active' | 'archived' }) =>
    send<Belief>('PATCH', `/beliefs/${id}`, body),

  deadEnds: () => get<DeadEnd[]>('/dead-ends'),
  createDeadEnd: (body: { title: string; reason: string; revisitTrigger?: string; questionId?: string }) =>
    send<DeadEnd>('POST', '/dead-ends', body),
  deadEndAction: (id: string, action: 'confirm' | 'dismiss' | 'reopen') => send<DeadEnd>('POST', `/dead-ends/${id}/${action}`),

  papers: (q: string) => get<Paper[]>(`/papers?${new URLSearchParams({ q })}`),
  paper: (id: string) => get<PaperDetail>(`/papers/${id}`),
  addPaper: (ref: string) => send<Paper>('POST', '/papers', { ref }),

  meetings: () => get<MeetingSummary[]>('/meetings'),
  meeting: (id: string) => get<Meeting>(`/meetings/${id}`),
  createMeeting: (body: { title: string; date?: string; topics: string[]; transcript: string }) =>
    send<Meeting>('POST', '/meetings', body),
  updateStance: (meetingId: string, stanceId: string, body: { verified?: boolean; stance?: MeetingStanceValue }) =>
    send<Meeting>('PATCH', `/meetings/${meetingId}/stances/${stanceId}`, body),
  deleteMeeting: (id: string) => send<void>('DELETE', `/meetings/${id}`),

  providers: () => get<Provider[]>('/providers'),
  saveProvider: (id: ProviderId, body: { apiKey?: string; model?: string; baseUrl?: string; enabled?: boolean }) =>
    send<Provider>('PUT', `/providers/${id}`, body),
  testProvider: (id: ProviderId) => send<ProviderTestResult>('POST', `/providers/${id}/test`),

  routing: () => get<Routing>('/routing'),
  saveRouting: (body: {
    priority?: Priority
    autoFallback?: boolean
    allowOverride?: boolean
    rules?: Array<{ task: string; primary: ProviderId; fallback: ProviderId | null }>
  }) => send<Routing>('PUT', '/routing', body),

  usage: (days: number) => get<Usage>(`/usage?days=${days}`),
  tasks: (provider: string) => get<TaskLog[]>(`/tasks?limit=150${provider ? `&provider=${provider}` : ''}`),

  saveSettings: (body: Partial<{
    teamName: string
    projectName: string
    projectEndDate: string
    monthlyBudgetUsd: number
    alertThreshold: number
    maxPapers: number
    backgroundWatch: boolean
    groqFreeTier: boolean
  }>) => send<Workspace>('PUT', '/settings', body),
  addMember: (body: { name: string; email: string; role: Role }) => send<Member>('POST', '/members', body),
  updateMember: (id: string, role: Role) => send<Member>('PATCH', `/members/${id}`, { role }),
  removeMember: (id: string) => send<void>('DELETE', `/members/${id}`),

  search: (q: string) => get<SearchResult[]>(`/search?q=${encodeURIComponent(q)}`),
}
