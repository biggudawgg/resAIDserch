/**
 * Get-started checklist for first-time visitors to the overview.
 *
 * Modelled on the behaviour KokonutUI describes for its Onboarding Checklist (a Kokonut UI Pro component, so no
 * source was available or used): a ring fills as steps are done, finished steps fold into one line, the next one
 * opens, and an all-set state closes it out. Progress comes from what the viewer actually does anywhere in the app
 * (see lib/onboarding.ts), not from ticking boxes.
 */
import { useId } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { ArrowRight, Check, X } from 'lucide-react'
import { cx } from '../lib/cx'
import { isMac } from '../lib/hooks'
import { hideOnboarding, type OnboardingStep, useOnboarding } from '../lib/onboarding'
import { useUI } from '../lib/ui'

const EASE_OUT = [0.23, 1, 0.32, 1] as const
const RING_R = 15
const RING_C = 2 * Math.PI * RING_R

interface StepDef {
  id: OnboardingStep
  title: string
  body: string
  action: string
}

const STEPS: StepDef[] = [
  {
    id: 'ask',
    title: 'Ask a research question',
    body: 'The agent searches arXiv, reads the papers, pulls claims with quotes and drafts a belief. You can watch every step.',
    action: 'Ask a question',
  },
  {
    id: 'review',
    title: 'Approve or reject a draft',
    body: 'Nothing becomes a team belief until a person signs off. Open a draft, read the cited evidence and decide.',
    action: 'Review a draft',
  },
  {
    id: 'paper',
    title: 'Open a paper from the library',
    body: 'Every paper shows the claims taken from it and the beliefs it supports, so you can check the trail back.',
    action: 'Open the library',
  },
  {
    id: 'palette',
    title: 'Jump anywhere with search',
    body: `Press ${isMac ? '⌘K' : 'Ctrl K'} to find questions, beliefs and papers, or to run commands like switching theme.`,
    action: 'Open search',
  },
]

export function OnboardingChecklist({ reviewTo }: { reviewTo: string }) {
  const { done, hidden } = useOnboarding()
  const { openAsk, openPalette } = useUI()
  const navigate = useNavigate()
  const titleId = useId()
  if (hidden) return null

  const count = STEPS.filter((s) => done.includes(s.id)).length
  const allDone = count === STEPS.length
  const next = STEPS.find((s) => !done.includes(s.id))

  const run = (step: OnboardingStep) => {
    if (step === 'ask') openAsk()
    else if (step === 'review') navigate(reviewTo)
    else if (step === 'paper') navigate('/library')
    else openPalette()
  }

  return (
    <MotionConfig reducedMotion="user">
      <section aria-labelledby={titleId} className="onb">
        <header className="onb-head">
          <svg aria-hidden className="onb-ring" viewBox="0 0 36 36">
            <circle className="onb-ring-track" cx="18" cy="18" r={RING_R} />
            <circle
              className="onb-ring-fill"
              cx="18"
              cy="18"
              r={RING_R}
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - count / STEPS.length)}
            />
          </svg>
          <div className="onb-heading">
            <h2 className="onb-title" id={titleId}>
              {allDone ? "You're all set" : 'Get to know resAIDserch'}
            </h2>
            <p className="onb-sub">
              {allDone ? 'You have tried every part of the demo.' : `${count} of ${STEPS.length} done · about two minutes`}
            </p>
          </div>
          <button aria-label="Hide the get-started checklist" className="onb-hide" onClick={hideOnboarding} title="Hide" type="button">
            <X aria-hidden />
          </button>
        </header>

        <AnimatePresence initial={false}>
          {!allDone && (
            <motion.ol
              animate={{ height: 'auto', opacity: 1 }}
              className="onb-steps"
              exit={{ height: 0, opacity: 0 }}
              initial={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.28, ease: EASE_OUT }}
            >
              {STEPS.map((step) => {
                const isDone = done.includes(step.id)
                const isNext = step.id === next?.id
                return (
                  <li className={cx('onb-step', isDone && 'is-done', isNext && 'is-next')} key={step.id}>
                    <span aria-hidden className="onb-mark">
                      <AnimatePresence initial={false} mode="popLayout">
                        {isDone ? (
                          <motion.span
                            animate={{ scale: 1, opacity: 1 }}
                            className="onb-check"
                            initial={{ scale: 0.4, opacity: 0 }}
                            key="done"
                            transition={{ duration: 0.22, ease: EASE_OUT }}
                          >
                            <Check />
                          </motion.span>
                        ) : (
                          <motion.span className="onb-dot" exit={{ scale: 0.4, opacity: 0 }} key="todo" transition={{ duration: 0.15 }} />
                        )}
                      </AnimatePresence>
                    </span>
                    <div className="onb-step-main">
                      <p className="onb-step-title">
                        {step.title}
                        <span className="sr-only">{isDone ? ', done' : ', not done yet'}</span>
                      </p>
                      {/* Only the next step is open; done ones fold to their title. */}
                      <AnimatePresence initial={false}>
                        {isNext && (
                          <motion.div
                            animate={{ height: 'auto', opacity: 1 }}
                            className="onb-step-body"
                            exit={{ height: 0, opacity: 0 }}
                            initial={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.26, ease: EASE_OUT }}
                          >
                            <p>{step.body}</p>
                            <button className="btn btn-secondary btn-sm" onClick={() => run(step.id)} type="button">
                              {step.action}
                              <ArrowRight aria-hidden />
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    {!isDone && !isNext && (
                      <button className="onb-skip-to link" onClick={() => run(step.id)} type="button">
                        {step.action}
                      </button>
                    )}
                  </li>
                )
              })}
            </motion.ol>
          )}
        </AnimatePresence>
        {allDone && (
          <div className="onb-done">
            <button className="btn btn-secondary btn-sm" onClick={hideOnboarding} type="button">
              Hide this
            </button>
          </div>
        )}
      </section>
    </MotionConfig>
  )
}
