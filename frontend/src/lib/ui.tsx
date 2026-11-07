import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cx } from './cx'

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

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), [])

  const toast = useCallback<UIContextValue['toast']>(
    (title, options) => {
      const id = nextToastId++
      setToasts((all) => [...all.slice(-3), { id, title, tone: options?.tone ?? 'success', description: options?.description }])
      window.setTimeout(() => dismiss(id), options?.tone === 'error' ? 7000 : 4200)
    },
    [dismiss],
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
      openPalette: () => setPaletteOpen(true),
      closePalette: () => setPaletteOpen(false),
      toast,
    }),
    [askOpen, paletteOpen, toast],
  )

  return (
    <UIContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite" aria-label="Notifications">
        {toasts.map((t) => {
          const Icon = TOAST_ICON[t.tone]
          return (
            <div key={t.id} className={cx('toast', `toast-${t.tone}`)} role="status">
              <Icon className="toast-icon" aria-hidden />
              <div className="toast-body">
                <p className="toast-title">{t.title}</p>
                {t.description && <p className="toast-desc">{t.description}</p>}
              </div>
              <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
                <X aria-hidden />
              </button>
            </div>
          )
        })}
      </div>
    </UIContext.Provider>
  )
}

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUI must be used inside UIProvider')
  return ctx
}
