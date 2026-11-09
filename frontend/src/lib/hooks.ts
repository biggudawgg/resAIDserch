import { useCallback, useEffect, useState, type RefObject } from 'react'
import { useSearchParams } from 'react-router-dom'
import { onAvatarChange, readAvatarVariant } from './faces'

export function useDebounced<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(id)
  }, [value, delay])
  return debounced
}

export function useElementWidth(ref: RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    setWidth(node.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return width
}

export function useHotkey(key: string, handler: () => void, { meta = false } = {}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (meta && !(e.metaKey || e.ctrlKey)) return
      if (e.key.toLowerCase() !== key.toLowerCase()) return
      e.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [key, handler, meta])
}

/** The viewer's chosen generated face (variant), or null for initials. Follows changes made elsewhere in the app. */
export function useMyAvatarVariant(): number | null {
  const [variant, setVariant] = useState<number | null>(readAvatarVariant)
  useEffect(() => onAvatarChange(setVariant), [])
  return variant
}

/**
 * Two-key jumps: press G, then a letter within a second (e.g. G then R for Research). Ignored while typing in a
 * field or with a modifier held, so it never fights text input or browser shortcuts.
 */
export function useGoShortcuts(targets: Record<string, string>, go: (path: string) => void) {
  useEffect(() => {
    let armedUntil = 0
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      if (document.querySelector('[aria-modal="true"]')) return
      const key = e.key.toLowerCase()
      if (Date.now() < armedUntil && targets[key]) {
        armedUntil = 0
        e.preventDefault()
        go(targets[key])
        return
      }
      armedUntil = key === 'g' ? Date.now() + 1000 : 0
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [targets, go])
}

/** Opens the paper drawer by setting `?paper=` on the current URL, keeping other params. */
export function useOpenPaper() {
  const [params, setParams] = useSearchParams()
  return useCallback(
    (paperId: string) => {
      const next = new URLSearchParams(params)
      next.set('paper', paperId)
      setParams(next)
    },
    [params, setParams],
  )
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
