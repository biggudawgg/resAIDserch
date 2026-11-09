import { Link } from 'react-router-dom'
import { Menu, Moon, Plus, Search, Sun } from 'lucide-react'
import { useWorkspace } from '../../api/hooks'
import { isMac } from '../../lib/hooks'
import { useTheme } from '../../lib/theme'
import { useUI } from '../../lib/ui'
import { Button, IconButton } from '../ui/Button'
import { Wordmark } from './Wordmark'

export function Topbar({ onMenu, onDemoInfo }: { onMenu: () => void; onDemoInfo: () => void }) {
  const { openAsk, openPalette } = useUI()
  const { theme, toggle } = useTheme()
  const workspace = useWorkspace()

  return (
    <header className="topbar">
      <IconButton className="menu-button" label="Open navigation" icon={<Menu />} onClick={onMenu} />
      <Link to="/" className="topbar-brand" aria-label="resAIDserch home">
        <Wordmark size={19} />
      </Link>
      <button type="button" className="search-trigger" onClick={openPalette} aria-label="Search and jump to">
        <Search aria-hidden />
        <span className="search-trigger-text">Search questions, beliefs, papers…</span>
        <kbd className="kbd">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <div className="topbar-right">
        {workspace.data?.demo !== false && (
          <button type="button" className="demo-pill" onClick={onDemoInfo} title="About this demo">
            Demo
          </button>
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
