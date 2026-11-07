import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { RefreshCw, ServerCrash } from 'lucide-react'
import { useWorkspace } from '../../api/hooks'
import { cx } from '../../lib/cx'
import { useHotkey } from '../../lib/hooks'
import { useUI } from '../../lib/ui'
import { PaperDrawer } from '../papers/PaperDrawer'
import { AskQuestionModal } from '../research/AskQuestionModal'
import { Button } from '../ui/Button'
import { CommandPalette } from './CommandPalette'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()
  const { askOpen, closeAsk, paletteOpen, openPalette, closePalette } = useUI()
  const workspace = useWorkspace()

  useEffect(() => setNavOpen(false), [location.pathname])
  useEffect(() => window.scrollTo(0, 0), [location.pathname])
  useHotkey('k', useCallback(() => openPalette(), [openPalette]), { meta: true })

  return (
    <div className={cx('app', navOpen && 'nav-open')}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Sidebar />
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden />}
      <div className="main">
        <Topbar onMenu={() => setNavOpen(true)} />
        {workspace.isError && (
          <div className="api-banner" role="alert">
            <ServerCrash aria-hidden />
            <span>
              <strong>Can't reach the Hindsight API.</strong> Start it with <code>python demo_server.py</code> in the backend
              folder.
            </span>
            <Button size="sm" icon={<RefreshCw />} onClick={() => workspace.refetch()}>
              Retry
            </Button>
          </div>
        )}
        <main id="main" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <AskQuestionModal open={askOpen} onClose={closeAsk} />
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <PaperDrawer />
    </div>
  )
}
