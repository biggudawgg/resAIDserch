import { useCallback, useEffect, useState, type RefObject } from 'react'
import { useSearchParams } from 'react-router-dom'

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
