/**
 * Background research runs in the top bar, ported from KokonutUI's Status Island ("status-island", Tailwind + motion).
 *
 * Original: "Status Island" by @dorianbaffier, https://kokonutui.com/docs/navigation/status-island
 * Copyright (c) Kokonut Labs. Licensed under the MIT License, https://github.com/kokonut-labs/kokonutui
 *
 * Changes from the original: tasks are the team's research runs, read from the questions list the app already polls
 * (useResearchTasks below), so a run started anywhere shows up here and its pill follows the current step. A run that
 * finishes while the app is open stays for a few seconds with an Open action, then leaves. It sits in the top bar
 * rather than floating, and uses the app's dark surface tokens. The demo playground is left out. The morphing pill,
 * the peeking layers behind it, the rolling percentage, the hover/focus/tap list and the focus hand-off are unchanged.
 */
import { type FocusEvent, type KeyboardEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion, type Transition } from 'motion/react'
import { useQuestions } from '../../api/hooks'
import { cx } from '../../lib/cx'
import { shortTitle } from '../../lib/format'

export type IslandTaskStatus = 'running' | 'done' | 'error'

export interface IslandTask {
  id: string
  label: string
  /** Optional second part, shown dimmed after the label. */
  detail?: string
  status: IslandTaskStatus
  /** 0 to 1 while running. */
  progress?: number
  action?: { label: string; onClick: () => void }
}

const MORPH: Transition = { type: 'spring', duration: 0.45, bounce: 0.18 }
const SWAP: Transition = { duration: 0.22, ease: [0.23, 1, 0.32, 1] }
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'
const MAX_PEEK = 2
const DISMISS_AFTER = 6000

/* ---------------------------------------------------------------- data */

/** Running research as island tasks, plus runs that finished while the app was open. */
function useResearchTasks(): { tasks: IslandTask[]; dismiss: (id: string) => void } {
  const questions = useQuestions()
  const navigate = useNavigate()
  const seenRunning = useRef(new Set<string>())
  const [finished, setFinished] = useState<IslandTask[]>([])

  useEffect(() => {
    const list = questions.data
    if (!list) return
    const ended: IslandTask[] = []
    for (const q of list) {
      if (q.status === 'running') {
        seenRunning.current.add(q.id)
      } else if (seenRunning.current.has(q.id)) {
        // Watched it run, now it has stopped: say how it went for a moment.
        seenRunning.current.delete(q.id)
        const failed = q.run?.status === 'failed'
        ended.push({
          id: `done-${q.id}-${q.run?.id ?? ''}`,
          status: failed ? 'error' : 'done',
          label: failed ? 'Research stopped' : 'Research finished',
          detail: shortTitle(q.question, 34),
          action: { label: 'Open', onClick: () => navigate(`/research/${q.id}`) },
        })
      }
    }
    if (ended.length) setFinished((all) => [...all.filter((t) => !ended.some((e) => e.id === t.id)), ...ended])
  }, [questions.data, navigate])

  const running: IslandTask[] = (questions.data ?? [])
    .filter((q) => q.status === 'running')
    .map((q) => ({
      id: `run-${q.id}`,
      status: 'running',
      label: q.run?.currentLabel ?? 'Researching',
      detail: shortTitle(q.question, 34),
      progress: q.run?.progress,
      action: { label: 'View', onClick: () => navigate(`/research/${q.id}`) },
    }))

  const dismiss = useCallback((id: string) => setFinished((all) => all.filter((t) => t.id !== id)), [])
  // Oldest first: finished runs sit behind the ones still going, which the pill shows.
  return { tasks: [...finished, ...running], dismiss }
}

/* ---------------------------------------------------------------- view */

/** A number whose digits roll to their new value. */
function RollingNumber({ value }: { value: number }) {
  const text = String(value)
  return (
    <span aria-hidden className="island-roll">
      {text.split('').map((char, i) => (
        // Keyed from the right, so the ones stay the ones when a digit is added.
        <span className="island-roll-digit" key={text.length - i}>
          <span className="island-roll-strip" style={{ transform: `translateY(${-Number(char) * 10}%)`, transitionTimingFunction: EASE_OUT }}>
            {'0123456789'.split('').map((d) => (
              <span key={d}>{d}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  )
}

function TaskIcon({ task }: { task: IslandTask }) {
  if (task.status === 'done') {
    return (
      <svg aria-hidden className="island-icon is-done" fill="none" viewBox="0 0 16 16">
        <circle cx="8" cy="8" fill="currentColor" opacity="0.18" r="8" />
        <motion.path
          animate={{ pathLength: 1 }}
          d="M4.75 8.25 7 10.5l4.25-4.75"
          initial={{ pathLength: 0 }}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.75"
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1], delay: 0.08 }}
        />
      </svg>
    )
  }
  if (task.status === 'error') {
    return (
      <svg aria-hidden className="island-icon is-error" fill="none" viewBox="0 0 16 16">
        <circle cx="8" cy="8" fill="currentColor" opacity="0.18" r="8" />
        <path d="M8 4.5v4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" />
        <circle cx="8" cy="11.25" fill="currentColor" r="1" />
      </svg>
    )
  }
  const known = typeof task.progress === 'number'
  const circumference = 2 * Math.PI * 6
  const progress = known ? Math.min(1, Math.max(0, task.progress ?? 0)) : 0.25
  return (
    <svg aria-hidden className={cx('island-icon', 'is-running', !known && 'is-spinning')} fill="none" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        strokeLinecap="round"
        strokeWidth="2"
        style={{ transition: `stroke-dashoffset 250ms ${EASE_OUT}` }}
      />
    </svg>
  )
}

function TaskTrailing({ task, inert = false }: { task: IslandTask; inert?: boolean }) {
  if (task.status === 'running' && typeof task.progress === 'number') {
    const percent = Math.round(Math.min(1, Math.max(0, task.progress)) * 100)
    return (
      <span className="island-percent">
        <RollingNumber value={percent} />%
      </span>
    )
  }
  if (task.action) {
    // Inside the closed pill (itself a button) the action is only a label; in the list it is a real button.
    if (inert) return <span className="island-action">{task.action.label}</span>
    const { label, onClick } = task.action
    return (
      <button
        className="island-action"
        onClick={(event) => {
          event.stopPropagation()
          onClick()
        }}
        type="button"
      >
        {label}
      </button>
    )
  }
  return null
}

function TaskRow({ task }: { task: IslandTask }) {
  return (
    <div className="island-row">
      <TaskIcon task={task} />
      <span className="island-text">
        {task.label}
        {task.detail ? <span className="island-detail"> · {task.detail}</span> : null}
      </span>
      {/* In the list, running tasks get their View action too. */}
      {task.status === 'running' && task.action ? (
        <>
          <TaskTrailing task={{ ...task, action: undefined }} />
          <TaskTrailing task={{ ...task, status: 'done' }} />
        </>
      ) : (
        <TaskTrailing task={task} />
      )}
    </div>
  )
}

const describe = (task: IslandTask) => [task.label, task.detail].filter(Boolean).join(', ')

export function StatusIsland({ className }: { className?: string }) {
  const { tasks, dismiss } = useResearchTasks()
  const [open, setOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const doneAt = useRef(new Map<string, number>())
  const lastStatus = useRef(new Map<string, IslandTaskStatus>())
  const current = tasks.length ? tasks[tasks.length - 1] : undefined
  const behind = Math.min(tasks.length - 1, MAX_PEEK)
  const expanded = open && tasks.length > 0

  const islandRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // The pill and the list swap places, so whichever held keyboard focus hands it to the other.
  const focusList = useRef(false)
  const focusPill = useRef(false)
  const skipOpen = useRef(false)

  useEffect(() => {
    if (expanded && focusList.current) {
      focusList.current = false
      listRef.current?.focus({ preventScroll: true })
    } else if (!expanded && focusPill.current) {
      focusPill.current = false
      skipOpen.current = true
      pillRef.current?.focus({ preventScroll: true })
    }
  }, [expanded])

  // A tap anywhere else closes the list on touch screens.
  useEffect(() => {
    if (!expanded) return
    const close = (event: globalThis.PointerEvent) => {
      if (!islandRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [expanded])

  // Announce new tasks and status changes, not every progress tick.
  useEffect(() => {
    for (const task of tasks) {
      if (lastStatus.current.get(task.id) !== task.status) {
        lastStatus.current.set(task.id, task.status)
        setAnnouncement(describe(task))
      }
    }
    const ids = new Set(tasks.map((task) => task.id))
    for (const id of lastStatus.current.keys()) {
      if (!ids.has(id)) {
        lastStatus.current.delete(id)
        doneAt.current.delete(id)
      }
    }
  }, [tasks])

  // Finished tasks leave on their own, but never while someone is reading.
  const taskKey = tasks.map((t) => `${t.id}:${t.status}`).join('|')
  useEffect(() => {
    if (expanded) return
    const now = Date.now()
    const timers: number[] = []
    for (const task of tasks) {
      if (task.status === 'running') continue
      const since = doneAt.current.get(task.id) ?? now
      doneAt.current.set(task.id, since)
      timers.push(window.setTimeout(() => dismiss(task.id), Math.max(0, DISMISS_AFTER - (now - since))))
    }
    return () => timers.forEach((t) => window.clearTimeout(t))
    // taskKey stands in for tasks: progress ticks must not restart the clocks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskKey, expanded, dismiss])

  // Reading restarts the clock, so a task doesn't vanish as the pointer leaves.
  useEffect(() => {
    if (expanded) {
      const now = Date.now()
      for (const id of doneAt.current.keys()) doneAt.current.set(id, now)
    }
  }, [expanded])

  const handlePointerEnter = useCallback((event: PointerEvent) => {
    if (event.pointerType === 'mouse') setOpen(true)
  }, [])
  const handlePointerLeave = useCallback((event: PointerEvent) => {
    if (event.pointerType === 'mouse') setOpen(false)
  }, [])
  const handleBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
  }, [])
  const handleFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (skipOpen.current) {
      skipOpen.current = false
      return
    }
    if ((event.target as Node) === pillRef.current) focusList.current = true
    setOpen(true)
  }, [])
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      focusPill.current = Boolean(islandRef.current?.contains(document.activeElement))
      setOpen(false)
    }
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <div className={cx('island-wrap', className)}>
        <output aria-live="polite" className="sr-only">
          {announcement}
        </output>
        <AnimatePresence>
          {current ? (
            <motion.div
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              className="island-anchor"
              exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
              initial={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
              key="island"
              transition={SWAP}
            >
              {/* Tasks waiting behind the current one peek out below it. */}
              {Array.from({ length: behind }, (_, i) => (
                <motion.div
                  animate={{ opacity: expanded ? 0 : 1 - (i + 1) * 0.3, y: expanded ? 0 : (i + 1) * 4, scale: 1 - (i + 1) * 0.06 }}
                  aria-hidden
                  className="island-peek"
                  initial={false}
                  key={i}
                  style={{ zIndex: -1 - i }}
                  transition={MORPH}
                />
              ))}
              <motion.div
                className="island"
                layout
                onBlur={handleBlur}
                onFocus={handleFocus}
                onKeyDown={handleKeyDown}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={handlePointerLeave}
                ref={islandRef}
                style={{ borderRadius: 18 }}
                transition={MORPH}
              >
                {expanded ? (
                  <motion.ul
                    animate={{ opacity: 1, filter: 'blur(0px)' }}
                    aria-label="Research runs"
                    className="island-list"
                    initial={{ opacity: 0, filter: 'blur(4px)' }}
                    key="list"
                    layout="position"
                    ref={listRef}
                    tabIndex={-1}
                    transition={{ ...SWAP, delay: 0.05 }}
                  >
                    {tasks.map((task) => (
                      <li key={task.id}>
                        <TaskRow task={task} />
                      </li>
                    ))}
                  </motion.ul>
                ) : (
                  <button
                    aria-expanded={false}
                    aria-label={`${describe(current)}. ${tasks.length} ${tasks.length === 1 ? 'run' : 'runs'}, show all`}
                    className="island-pill"
                    onClick={() => setOpen(true)}
                    ref={pillRef}
                    type="button"
                  >
                    <AnimatePresence initial={false} mode="popLayout">
                      <motion.div
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        className="island-pill-face"
                        exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
                        initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }}
                        key={`${current.id}-${current.status}-${current.label}`}
                        layout="position"
                        transition={SWAP}
                      >
                        <TaskIcon task={current} />
                        <span className="island-text">
                          {current.label}
                          {current.detail ? <span className="island-detail"> · {current.detail}</span> : null}
                        </span>
                        <span className="island-trail">
                          <TaskTrailing inert task={current} />
                        </span>
                      </motion.div>
                    </AnimatePresence>
                  </button>
                )}
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}
