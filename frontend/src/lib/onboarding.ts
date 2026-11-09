import { useEffect, useState } from 'react'

/** The get-started steps on the overview, in the order the checklist shows them. */
export type OnboardingStep = 'ask' | 'review' | 'paper' | 'palette'

export interface OnboardingState {
  done: OnboardingStep[]
  /** The checklist was closed with "Hide"; it stays away until preferences are reset. */
  hidden: boolean
}

// Cleared by "Reset my preferences" in the profile menu, which lists this key.
const KEY = 'resaidserch.onboarding'
const EVENT = 'resaidserch:onboarding'
const STEPS: OnboardingStep[] = ['ask', 'review', 'paper', 'palette']

function read(): OnboardingState {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (parsed && typeof parsed === 'object') {
      const { done, hidden } = parsed as Partial<OnboardingState>
      return {
        done: Array.isArray(done) ? done.filter((s): s is OnboardingStep => STEPS.includes(s as OnboardingStep)) : [],
        hidden: hidden === true,
      }
    }
  } catch {
    // Blocked or corrupt storage: start fresh.
  }
  return { done: [], hidden: false }
}

function write(state: OnboardingState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Storage blocked: progress lasts for this visit only.
  }
  window.dispatchEvent(new Event(EVENT))
}

/** Records that the viewer did one of the get-started steps. Safe to call repeatedly from anywhere. */
export function markOnboardingStep(step: OnboardingStep) {
  const state = read()
  if (!state.done.includes(step)) write({ ...state, done: [...state.done, step] })
}

export function hideOnboarding() {
  write({ ...read(), hidden: true })
}

/** The checklist's state, following changes made anywhere in the app (and a preferences reset). */
export function useOnboarding(): OnboardingState {
  const [state, setState] = useState(read)
  useEffect(() => {
    const sync = () => setState(read())
    window.addEventListener(EVENT, sync)
    window.addEventListener('resaidserch:layout-reset', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('resaidserch:layout-reset', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return state
}
