/**
 * Live view of a research run, ported from KokonutUI's AI State Loading ("ai-loading", Tailwind + motion).
 *
 * Original: "AI Loading State" v2.0.0 by @kokonutui, https://kokonutui.com/docs/ai/ai-loading
 * Copyright (c) Kokonut Labs. Licensed under the MIT License, https://github.com/kokonut-labs/kokonutui
 *
 * Changes from the original: steps come from the run the API reports (its seven pipeline steps), and each step's
 * log lines are what actually happened: which provider it was routed to and why, any fallback, and the result. Step
 * times and the elapsed clock use the server's timestamps instead of timing on the client, so a page opened mid-run
 * shows the real figures. A skipped step reads as done. The demo loop is left out; styling uses CSS classes.
 * The step icons, the filling rail, the scrolling log, the wave on the running label and the fold-away on
 * completion are unchanged.
 */
import { useEffect, useId, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import type { RunDetail, RunStep } from '../../api/types'
import { cx } from '../../lib/cx'
import { providerLabel } from '../../lib/providers'

type Status = 'pending' | 'running' | 'done' | 'error'

const EASE_OUT = [0.23, 1, 0.32, 1] as const
const LINE_HEIGHT = 22
const VISIBLE_LINES = 3

const statusOf = (step: RunStep): Status =>
  step.status === 'failed' ? 'error' : step.status === 'done' || step.status === 'skipped' ? 'done' : step.status

/** What a step did, as log lines: where it was routed, why, any fallback, and the result once there is one. */
function logOf(step: RunStep): string[] {
  const lines: string[] = []
  if (step.fallbackFrom) lines.push(`${providerLabel(step.fallbackFrom)} failed, retrying on the fallback`)
  if (step.routedTo) lines.push(`routed to ${providerLabel(step.routedTo)}${step.model ? ` · ${step.model}` : ''}`)
  else if (step.executor === 'arxiv') lines.push('querying the arXiv API')
  else if (step.executor === 'local') lines.push('running locally, no model call')
  if (step.routeReason) lines.push(`why: ${step.routeReason.toLowerCase()}`)
  if (step.detail) lines.push(step.detail)
  return lines
}

const formatClock = (seconds: number) =>
  seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${(seconds % 60).toString().padStart(2, '0')}s`

const formatStepTime = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`)

/** Seconds since the run started on the server, ticking while it runs. */
function useElapsed(startedAt: string, finishedAt: string | null, running: boolean) {
  const start = Date.parse(startedAt)
  const compute = () => Math.max(0, Math.floor(((finishedAt ? Date.parse(finishedAt) : Date.now()) - start) / 1000))
  const [seconds, setSeconds] = useState(compute)
  useEffect(() => {
    setSeconds(compute())
    if (!running) return
    const id = window.setInterval(() => setSeconds(compute()), 500)
    return () => window.clearInterval(id)
    // compute only reads the props listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, finishedAt, running])
  return seconds
}

function StepIcon({ status }: { status: Status }) {
  return (
    <span className="aload-icon">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          className="aload-icon-face"
          exit={{ opacity: 0, filter: 'blur(2px)' }}
          initial={{ opacity: 0, filter: 'blur(2px)' }}
          key={status}
          transition={{ duration: 0.18, ease: EASE_OUT }}
        >
          {status === 'pending' && <span className="aload-dot" />}
          {status === 'running' && (
            <svg aria-hidden className="aload-spin" fill="none" viewBox="0 0 16 16">
              <circle className="aload-spin-track" cx="8" cy="8" r="6.25" strokeWidth="1.5" />
              <path className="aload-spin-head" d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" strokeLinecap="round" strokeWidth="1.5" />
            </svg>
          )}
          {status === 'done' && (
            <svg aria-hidden className="aload-done" fill="none" viewBox="0 0 16 16">
              {/* The check draws itself once, from the short stroke out. */}
              <motion.path
                animate={{ pathLength: 1 }}
                d="M3.5 8.5 6.5 11.5 12.5 4.5"
                initial={{ pathLength: 0 }}
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.75"
                transition={{ duration: 0.3, ease: EASE_OUT, delay: 0.05 }}
              />
            </svg>
          )}
          {status === 'error' && (
            <svg aria-hidden className="aload-error" fill="none" viewBox="0 0 16 16">
              <path d="M4.5 4.5l7 7m0-7-7 7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" />
            </svg>
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/** The running step's latest log lines, scrolling up as new ones arrive. */
function StepLog({ lines }: { lines: string[] }) {
  const offset = Math.max(0, lines.length - VISIBLE_LINES)
  const faded = lines.length > VISIBLE_LINES - 1
  return (
    <div aria-hidden className={cx('aload-log', faded && 'is-faded')} style={{ height: LINE_HEIGHT * Math.min(lines.length, VISIBLE_LINES) }}>
      <div className="aload-log-track" style={{ transform: `translateY(${-offset * LINE_HEIGHT}px)` }}>
        {lines.map((line, index) => (
          <motion.div
            animate={{ opacity: 1 }}
            className="aload-log-line"
            initial={{ opacity: 0 }}
            key={`${index}-${line}`}
            style={{ height: LINE_HEIGHT }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
          >
            <span className="aload-log-n">{index + 1}</span>
            <span className="aload-log-text">{line}</span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

/** A soft brightness wave through the running step's letters. */
function WaveText({ text }: { text: string }) {
  return (
    <>
      {Array.from(text).map((char, i) => (
        <span className="aload-wave" key={i} style={{ animationDelay: `${i * 0.05}s` }}>
          {char}
        </span>
      ))}
    </>
  )
}

function StepRow({ step, isLast }: { step: RunStep; isLast: boolean }) {
  const status = statusOf(step)
  const lines = logOf(step)
  return (
    <li className={cx('aload-step', `is-${status}`)}>
      {/* The rail between icons fills in as each step completes. */}
      {!isLast && (
        <span aria-hidden className="aload-rail">
          <span className={cx('aload-rail-fill', status === 'done' && 'is-filled')} />
        </span>
      )}
      <StepIcon status={status} />
      <div className="aload-step-main">
        <div className="aload-step-head">
          <p className="aload-label">
            {status === 'running' ? (
              <>
                <span className="sr-only">{step.label}</span>
                <span aria-hidden>
                  <WaveText text={step.label} />
                </span>
              </>
            ) : (
              step.label
            )}
            {step.status === 'skipped' && <span className="aload-skipped"> · skipped</span>}
          </p>
          {status !== 'pending' && status !== 'running' && step.durationMs !== null && (
            <motion.span animate={{ opacity: 1 }} className="aload-time" initial={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE_OUT }}>
              {formatStepTime(step.durationMs)}
            </motion.span>
          )}
        </div>
        {status === 'running' && lines.length > 0 && <StepLog lines={lines} />}
        {status === 'error' && step.detail && <p className="aload-error-text">{step.detail}</p>}
      </div>
    </li>
  )
}

export function AgentProgress({ run }: { run: RunDetail }) {
  const listId = useId()
  const steps = run.steps
  const running = steps.find((s) => s.status === 'running')
  const failed = steps.find((s) => s.status === 'failed')
  const isDone = run.status === 'completed'
  const isActive = run.status === 'running'
  const seconds = useElapsed(run.startedAt, run.finishedAt, isActive)

  // Open while working; folds away once the run completes, until the viewer opens it again. Synced during render, so
  // a run that is already done when this mounts starts folded instead of playing a collapse.
  const [isOpen, setIsOpen] = useState(!isDone)
  const [wasDone, setWasDone] = useState(isDone)
  if (wasDone !== isDone) {
    setWasDone(isDone)
    setIsOpen(!isDone)
  }

  let title = 'Getting ready'
  if (failed || run.status === 'failed') title = `Stopped at: ${failed?.label ?? 'a step'}`
  else if (isDone) title = `Worked for ${formatClock(seconds)}`
  else if (running) title = running.label

  return (
    <MotionConfig reducedMotion="user">
      <div className="aload">
        <button aria-controls={listId} aria-expanded={isOpen} className="aload-header" onClick={() => setIsOpen((open) => !open)} type="button">
          {/* <output> has the implicit role="status", so the current step is announced as it changes. */}
          <output className="aload-title">{title}</output>
          {isActive && <span className="aload-meta">{formatClock(seconds)}</span>}
          {isActive && (
            <span className="aload-meta">
              · step {Math.min(steps.length, steps.filter((s) => statusOf(s) === 'done').length + 1)} of {steps.length}
            </span>
          )}
          {isDone && <span className="aload-meta">· {steps.length} steps</span>}
          <ChevronDown aria-hidden className={cx('aload-chevron', isOpen && 'is-open')} />
        </button>

        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.ol
              animate={{ height: 'auto', opacity: 1 }}
              className="aload-steps"
              exit={{ height: 0, opacity: 0 }}
              id={listId}
              initial={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
            >
              {steps.map((step, i) => (
                <StepRow isLast={i === steps.length - 1} key={step.key} step={step} />
              ))}
            </motion.ol>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}
