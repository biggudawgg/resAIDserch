import { Link } from 'react-router-dom'
import { FlaskRound, Menu, Moon, Plus, Route, Search, Sun } from 'lucide-react'
import { useRouting, useWorkspace } from '../../api/hooks'
import { isMac } from '../../lib/hooks'
import { PRIORITY_META } from '../../lib/providers'
import { useTheme } from '../../lib/theme'
import { useUI } from '../../lib/ui'
import { Button, IconButton } from '../ui/Button'

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { openAsk, openPalette } = useUI()
  const { theme, toggle } = useTheme()
  const workspace = useWorkspace()
  const routing = useRouting()

  return (
    <header className="topbar">
      <IconButton className="menu-button" label="Open navigation" icon={<Menu />} onClick={onMenu} />
      <button type="button" className="search-trigger" onClick={openPalette} aria-label="Search and jump to">
        <Search aria-hidden />
        <span className="search-trigger-text">Search questions, beliefs, papers…</span>
        <kbd className="kbd">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <div className="topbar-right">
        {workspace.data?.demo && (
          <span
            className="demo-pill"
            title="Sample workspace. Paper search hits arXiv live; the LLM steps run as labelled heuristics until live model calls are wired in."
          >
            <FlaskRound aria-hidden />
            Demo workspace
          </span>
        )}
        {routing.data && (
          <Link to="/providers" className="routing-pill" title="Provider routing policy">
            <Route aria-hidden />
            {PRIORITY_META[routing.data.priority].label}
          </Link>
        )}
        <IconButton
          label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          icon={theme === 'dark' ? <Sun /> : <Moon />}
          onClick={toggle}
        />
        <Button variant="primary" icon={<Plus />} onClick={openAsk} className="ask-button" aria-label="Ask a research question">
          <span className="ask-button-text">Ask question</span>
        </Button>
      </div>
    </header>
  )
}
