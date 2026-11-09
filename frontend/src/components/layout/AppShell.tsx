import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { RefreshCw, ServerCrash } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspace } from '../../api/hooks'
import { warmAllRoutes } from '../../api/prefetch'
import { cx } from '../../lib/cx'
import { useGoShortcuts, useHotkey } from '../../lib/hooks'
import { useUI } from '../../lib/ui'
import { ErrorBoundary } from '../ErrorBoundary'
import { PaperDrawer } from '../papers/PaperDrawer'
import { AskQuestionModal } from '../research/AskQuestionModal'
import { Button } from '../ui/Button'
import { CommandPalette } from './CommandPalette'
import { shouldShowDemoSplash } from '../../lib/demoSplash'
import { DemoSplash } from './DemoSplash'
import { RouteLoader } from './RouteLoader'
import { Sidebar } from './Sidebar'
import { StatusIsland } from './StatusIsland'
import { Topbar } from './Topbar'

/** G then a letter jumps to a page; shown as hints in the command palette. */
const GO_KEYS: Record<string, string> = { o: '/', r: '/research', b: '/beliefs', l: '/library', p: '/providers' }

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false)
  const [splashOpen, setSplashOpen] = useState(shouldShowDemoSplash)
  const location = useLocation()
  const navigate = useNavigate()
  const { askOpen, closeAsk, paletteOpen, openPalette, closePalette } = useUI()
  const workspace = useWorkspace()
  const queryClient = useQueryClient()

  // Block bodies on purpose: an effect must return a cleanup function or nothing. Newer Chromium (e.g. Brave)
  // makes window.scrollTo() return a Promise, and `() => window.scrollTo(0, 0)` handed that Promise to React as
  // the cleanup, which crashed the whole app on the next navigation.
  useEffect(() => {
    warmAllRoutes(queryClient)
  }, [queryClient])
  useEffect(() => {
    setNavOpen(false)
    window.scrollTo(0, 0)
  }, [location.pathname])
  useHotkey('k', useCallback(() => openPalette(), [openPalette]), { meta: true })
  useGoShortcuts(GO_KEYS, navigate)
  // The command palette's "About this demo" asks for the splash without knowing where it lives.
  useEffect(() => {
    const open = () => setSplashOpen(true)
    window.addEventListener('resaidserch:demo-info', open)
    return () => window.removeEventListener('resaidserch:demo-info', open)
  }, [])

  return (
    <div className={cx('app', navOpen && 'nav-open')}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Sidebar />
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden />}
      <div className="main">
        <Topbar onMenu={() => setNavOpen(true)} onDemoInfo={() => setSplashOpen(true)} />
        {workspace.isError && (
          <div className="api-banner" role="alert">
            <ServerCrash aria-hidden />
            <span>
              <strong>Can't reach the resAIDserch API.</strong> Start it with <code>python demo_server.py</code> in the backend
              folder.
            </span>
            <Button size="sm" icon={<RefreshCw />} onClick={() => workspace.refetch()}>
              Retry
            </Button>
          </div>
        )}
        <main id="main" className="content" tabIndex={-1}>
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
        <RouteLoader />
      </div>
      <AskQuestionModal open={askOpen} onClose={closeAsk} />
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <PaperDrawer />
      {/* Phones only (CSS): the top bar's island has no room there, so this one floats at the bottom. */}
      <StatusIsland className="floating-island" />
      <DemoSplash open={splashOpen} onClose={() => setSplashOpen(false)} />
    </div>
  )
}
