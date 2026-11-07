import type { Priority, ProviderId, RunStep } from '../api/types'

export const PROVIDER_ORDER: ProviderId[] = ['claude', 'openai', 'groq', 'custom']

export const PROVIDER_LABEL: Record<string, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  groq: 'Groq',
  custom: 'Custom',
  demo: 'Demo heuristic',
  local: 'Local',
  arxiv: 'arXiv',
}

export function providerLabel(id: string | null | undefined): string {
  if (!id) return '—'
  return PROVIDER_LABEL[id] ?? id
}

export const PRIORITY_META: Record<Priority, { label: string; description: string }> = {
  quality: {
    label: 'Quality first',
    description: 'Claude reads papers and reasons; Groq handles quick lookups. Cost is secondary.',
  },
  balanced: {
    label: 'Balanced',
    description: 'Top models for claims and briefings, cheaper models for scoring and stances.',
  },
  speed: { label: 'Speed first', description: 'Fastest provider first, with a quality fallback.' },
  cost: { label: 'Cost first', description: 'Free tier first, cheapest paid fallback.' },
}

export function executorLabel(step: RunStep): string {
  switch (step.executor) {
    case 'llm':
      return `Ran on ${providerLabel(step.routedTo)}${step.model ? ` · ${step.model}` : ''}`
    case 'heuristic':
      return 'Ran as a demo heuristic (live model calls are not enabled in the demo server)'
    case 'arxiv':
      return 'arXiv API keyword search'
    case 'local':
      return 'Local processing'
    case 'sample':
      return 'Sample output'
    default:
      if (step.status === 'running') return 'In progress…'
      return step.status === 'pending' ? 'Waiting' : '—'
  }
}
