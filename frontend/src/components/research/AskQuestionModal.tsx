import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Workflow } from 'lucide-react'
import { api } from '../../api/client'
import { useApiMutation, useProviders, useRouting } from '../../api/hooks'
import type { ProviderId, ProviderStatus } from '../../api/types'
import { cx } from '../../lib/cx'
import { PRIORITY_META } from '../../lib/providers'
import { useUI } from '../../lib/ui'
import { Button } from '../ui/Button'
import { Field, Segmented, Textarea } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { ProviderDot } from '../ui/ProviderChip'

const EXAMPLES = [
  'Does FlashAttention-2 speed up prefill for 8k-token prompts?',
  'Is grouped-query attention worth retrofitting into a 7B model?',
  'Can AWQ 4-bit weights keep quality for a 13B chat model?',
]

const STATUS_SHORT: Record<ProviderStatus, string> = {
  connected: 'Connected',
  untested: 'Key saved',
  error: 'Key failed',
  not_configured: 'No key yet',
}

export function AskQuestionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [question, setQuestion] = useState('')
  const [context, setContext] = useState('')
  const [mode, setMode] = useState<'auto' | 'force'>('auto')
  const [provider, setProvider] = useState<ProviderId>('claude')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { toast } = useUI()
  const providers = useProviders()
  const routing = useRouting()
  const ask = useApiMutation((body: { question: string; context?: string; provider: ProviderId | null }) => api.ask(body))

  useEffect(() => {
    if (open) setError(null)
  }, [open])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const text = question.trim()
    if (text.length < 8) {
      setError('Write the question as a full sentence (at least 8 characters).')
      return
    }
    ask.mutate(
      { question: text, context: context.trim() || undefined, provider: mode === 'force' ? provider : null },
      {
        onSuccess: (created) => {
          onClose()
          setQuestion('')
          setContext('')
          setMode('auto')
          toast('Research started', { description: 'The agent is searching arXiv for papers.' })
          navigate(`/research/${created.id}`)
        },
        onError: (err) => setError(err.message),
      },
    )
  }

  const policy = routing.data ? PRIORITY_META[routing.data.priority].label.toLowerCase() : 'current'

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Ask a research question"
      description="The agent searches the literature, extracts claims with exact quotes, checks for contradictions, and drafts a belief for your team to review."
      footer={
        <>
          <span className="modal-footnote">
            <Workflow aria-hidden />7-step pipeline, from paper search to a draft belief
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="ask-form" loading={ask.isPending} icon={<Sparkles />}>
            Start research
          </Button>
        </>
      }
    >
      <form id="ask-form" className="form" onSubmit={submit}>
        <Field label="Question" htmlFor="ask-question" error={error}>
          <Textarea
            id="ask-question"
            data-autofocus
            rows={3}
            maxLength={500}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="e.g. Does FlashAttention-2 speed up prefill for 8k-token prompts on H100s?"
          />
        </Field>
        <div className="examples">
          <span className="examples-label">Try one:</span>
          {EXAMPLES.map((example) => (
            <button key={example} type="button" className="chip" onClick={() => setQuestion(example)}>
              {example}
            </button>
          ))}
        </div>
        <Field
          label="Context"
          htmlFor="ask-context"
          optional
          hint="Hardware, model size, constraints, or what you've tried. Helps the agent judge relevance."
        >
          <Textarea id="ask-context" rows={2} maxLength={2000} value={context} onChange={(event) => setContext(event.target.value)} />
        </Field>
        <fieldset className="fieldset">
          <legend className="field-label">Provider routing</legend>
          <Segmented
            label="Provider routing"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'auto', label: 'Automatic' },
              { value: 'force', label: 'Choose a provider' },
            ]}
          />
          {mode === 'auto' ? (
            <p className="field-hint">
              Each step goes to the best provider for that task under your {policy} policy, retrying on the next best if one
              fails.
            </p>
          ) : (
            <div className="provider-pick" role="radiogroup" aria-label="Provider for every step">
              {providers.data?.map((p) => (
                <label key={p.id} className={cx('provider-option', provider === p.id && 'is-selected')}>
                  <input type="radio" name="ask-provider" value={p.id} checked={provider === p.id} onChange={() => setProvider(p.id)} />
                  <ProviderDot provider={p.id} />
                  <span className="provider-option-name">{p.short}</span>
                  <span className="provider-option-status">{STATUS_SHORT[p.status]}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      </form>
    </Modal>
  )
}
