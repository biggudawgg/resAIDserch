import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Minus, X } from 'lucide-react'
import type { RunDetail, RunStep, RunSummary, StepStatus } from '../../api/types'
import { cx } from '../../lib/cx'
import { formatDuration, formatNumber, formatUsdPrecise } from '../../lib/format'
import { executorLabel, providerLabel } from '../../lib/providers'
import { ProviderChip } from '../ui/ProviderChip'

const TOTAL_STEPS = 7

const STATUS_TEXT: Record<StepStatus, string> = {
  pending: 'Waiting',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
}

function NodeIcon({ step, index }: { step: RunStep; index: number }) {
  switch (step.status) {
    case 'done':
      return <Check aria-hidden />
    case 'running':
      return <Loader2 className="spin" aria-hidden />
    case 'failed':
      return <X aria-hidden />
    case 'skipped':
      return <Minus aria-hidden />
    default:
      return <span aria-hidden>{index + 1}</span>
  }
}

function stepMeta(step: RunStep): string {
  if (step.status === 'pending' || step.status === 'skipped') return STATUS_TEXT[step.status]
  const who = step.routedTo ? providerLabel(step.routedTo) : step.executor === 'arxiv' ? 'arXiv' : 'Local'
  const time = step.durationMs != null ? ` · ${formatDuration(step.durationMs)}` : ''
  return `${who}${time}`
}

function defaultIndex(run: RunDetail): number {
  if (run.currentStep !== null) return run.currentStep
  const failed = run.steps.findIndex((s) => s.status === 'failed')
  if (failed >= 0) return failed
  const lastDone = run.steps.map((s) => s.status).lastIndexOf('done')
  return lastDone >= 0 ? lastDone : 0
}

export function PipelineTracker({ run }: { run: RunDetail }) {
  const [selected, setSelected] = useState<number | null>(null)
  const index = selected ?? defaultIndex(run)
  const step = run.steps[index]
  const stepsRef = useRef<HTMLOListElement>(null)

  // On narrow screens the step row scrolls sideways; keep the selected step centred without moving the page.
  useEffect(() => {
    const list = stepsRef.current
    const item = list?.children[index] as HTMLElement | undefined
    if (!list || !item || list.scrollWidth <= list.clientWidth) return
    list.scrollLeft = item.offsetLeft - list.clientWidth / 2 + item.offsetWidth / 2
  }, [index])

  return (
    <div className="pipeline">
      <ol className="pipeline-steps" ref={stepsRef}>
        {run.steps.map((s, i) => (
          <li key={s.key} className={cx('pstep', `is-${s.status}`, i === index && 'is-selected')}>
            <button
              type="button"
              className="pstep-btn"
              onClick={() => setSelected(i)}
              aria-pressed={i === index}
              aria-label={`Step ${i + 1}, ${s.label}: ${STATUS_TEXT[s.status]}`}
            >
              <span className="pstep-node">
                <NodeIcon step={s} index={i} />
              </span>
              <span className="pstep-label">{s.short}</span>
              <span className="pstep-meta">{stepMeta(s)}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="pstep-detail" aria-live="polite">
        <div className="pstep-detail-head">
          <span className="pstep-detail-index">
            Step {index + 1} of {run.steps.length}
          </span>
          <h3 className="pstep-detail-title">{step.label}</h3>
          <span className={cx('pstep-state', `is-${step.status}`)}>{STATUS_TEXT[step.status]}</span>
        </div>
        <p className="muted">{step.description}</p>
        <dl className="kv">
          <div>
            <dt>Routed to</dt>
            <dd>{step.routedTo ? <ProviderChip provider={step.routedTo} model={step.model} /> : 'No model needed'}</dd>
          </div>
          {step.routeReason && (
            <div>
              <dt>Why</dt>
              <dd>{step.routeReason}</dd>
            </div>
          )}
          <div>
            <dt>Executed as</dt>
            <dd>{executorLabel(step)}</dd>
          </div>
          <div>
            <dt>Result</dt>
            <dd>{step.detail ?? (step.status === 'running' ? 'Working…' : '—')}</dd>
          </div>
          {step.inputTokens + step.outputTokens > 0 && (
            <div>
              <dt>Usage</dt>
              <dd>
                {formatNumber(step.inputTokens)} in · {formatNumber(step.outputTokens)} out · {formatUsdPrecise(step.costUsd)}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  )
}

function segmentStates(run: RunSummary): StepStatus[] {
  if (run.status === 'completed') return Array(TOTAL_STEPS).fill('done')
  if (run.status === 'running') {
    const current = run.currentStep ?? Math.floor(run.progress * TOTAL_STEPS)
    return Array.from({ length: TOTAL_STEPS }, (_, i) => (i < current ? 'done' : i === current ? 'running' : 'pending'))
  }
  const failedAt = Math.max(0, Math.round(run.progress * TOTAL_STEPS) - 1)
  return Array.from({ length: TOTAL_STEPS }, (_, i) => (i < failedAt ? 'done' : i === failedAt ? 'failed' : 'skipped'))
}

export function PipelineMini({ run }: { run: RunSummary }) {
  const states = segmentStates(run)
  const label =
    run.status === 'running' && run.currentStep !== null
      ? `Step ${run.currentStep + 1} of ${TOTAL_STEPS} · ${run.currentLabel}`
      : run.status === 'failed'
        ? 'Stopped with an error'
        : 'Complete'
  return (
    <div className="pmini">
      <div className="pmini-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(run.progress * 100)} aria-label="Research progress">
        {states.map((state, i) => (
          <span key={i} className={cx('pmini-seg', `is-${state}`)} />
        ))}
      </div>
      <div className="pmini-text">
        <span>{label}</span>
        {run.status === 'running' && run.currentProvider && (
          <span className="pmini-provider">
            routed to <ProviderChip provider={run.currentProvider} />
          </span>
        )}
      </div>
    </div>
  )
}
