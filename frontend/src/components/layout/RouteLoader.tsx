import { useEffect, useState } from 'react'
import { useIsFetching } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'

const SHOW_AFTER_MS = 300 // skip the flash on normal loads (a warm round trip is ~150-250 ms)
const SLOW_AFTER_MS = 2500 // Cloud Run cold start territory

/**
 * Spinner over the page while it waits for its first data. Only counts queries a mounted component is using
 * (observers > 0) that have no data yet, so background prefetches and refetches of cached data never trigger it.
 */
export function RouteLoader() {
  const loading = useIsFetching({ predicate: (q) => q.state.data === undefined && q.getObserversCount() > 0 }) > 0
  const [visible, setVisible] = useState(false)
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (!loading) {
      setVisible(false)
      setSlow(false)
      return
    }
    const show = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS)
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS)
    return () => {
      window.clearTimeout(show)
      window.clearTimeout(slowTimer)
    }
  }, [loading])

  if (!visible) return null
  return (
    <div className="route-loader" role="status" aria-live="polite">
      <div className="route-loader-inner">
        <Loader2 className="spin route-loader-icon" aria-hidden />
        <p className="route-loader-title">{slow ? 'Waking up the demo server…' : 'Loading…'}</p>
        {slow && <p className="route-loader-sub">It sleeps when nobody is using it. This takes a few seconds.</p>}
      </div>
    </div>
  )
}
