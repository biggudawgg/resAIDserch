import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, Info, XCircle } from 'lucide-react'
import { markOnboardingStep } from './onboarding'
import { NotificationStack, type StackNotification } from '../components/ui/NotificationStack'

type ToastTone = 'success' | 'error' | 'info'

interface Toast {
  id: number
  tone: ToastTone
  title: string
  description?: string
}

interface UIContextValue {
  askOpen: boolean
  openAsk: () => void
  closeAsk: () => void
  paletteOpen: boolean
  openPalette: () => void
  closePalette: () => void
  toast: (title: string, options?: { tone?: ToastTone; description?: string }) => void
}

const UIContext = createContext<UIContextValue | null>(null)
let nextToastId = 1

const TOAST_ICON = { success: CheckCircle2, error: XCircle, info: Info }

export function UIProvider({ children }: { children: ReactNode }) {
  const [askOpen, setAskOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => setToasts((all) => all.filter((t) => String(t.id) !== id)), [])

  // Newest first; the stack shows a few and keeps the rest one swipe away. It owns the timers, so a timed-out toast
  // leaves with the same flight as a swiped one, and the countdown pauses while the stack is hovered or focused.
  const toast = useCallback<UIContextValue['toast']>((title, options) => {
    const id = nextToastId++
    setToasts((all) => [{ id, title, tone: options?.tone ?? 'success', description: options?.description }, ...all].slice(0, 6))
  }, [])

  const stackItems = useMemo<StackNotification[]>(
    () =>
      toasts.map((t) => {
        const Icon = TOAST_ICON[t.tone]
        return {
          id: String(t.id),
          title: t.title,
          body: t.description,
          time: 'now',
          duration: t.tone === 'error' ? 8000 : 5000,
          icon: (
            <span className={`nstack-tile tile-${t.tone}`}>
              <Icon aria-hidden />
            </span>
          ),
        }
      }),
    [toasts],
  )

  const value = useMemo<UIContextValue>(
    () => ({
      askOpen,
      openAsk: () => {
        setPaletteOpen(false)
        setAskOpen(true)
      },
      closeAsk: () => setAskOpen(false),
      paletteOpen,
      openPalette: () => {
        markOnboardingStep('palette')
        setPaletteOpen(true)
      },
      closePalette: () => setPaletteOpen(false),
      toast,
    }),
    [askOpen, paletteOpen, toast],
  )

  return (
    <UIContext.Provider value={value}>
      {children}
      <NotificationStack className="toast-stack" items={stackItems} onDismiss={dismiss} />
    </UIContext.Provider>
  )
}

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUI must be used inside UIProvider')
  return ctx
}
