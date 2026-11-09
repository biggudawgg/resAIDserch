import { Link } from 'react-router-dom'
import { Menu, Plus, Search } from 'lucide-react'
import { useWorkspace } from '../../api/hooks'
import { isMac } from '../../lib/hooks'
import { useUI } from '../../lib/ui'
import { Button, IconButton } from '../ui/Button'
import { StatusIsland } from './StatusIsland'
import { ThemeLamp } from './ThemeLamp'
import { Wordmark } from './Wordmark'

export function Topbar({ onMenu, onDemoInfo }: { onMenu: () => void; onDemoInfo: () => void }) {
  const { openAsk, openPalette } = useUI()
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
      <StatusIsland className="topbar-island" />
      <div className="topbar-right">
        {workspace.data?.demo !== false && (
          <button type="button" className="demo-pill" onClick={onDemoInfo} title="About this demo">
            Demo
          </button>
        )}
        <ThemeLamp />
        <Button variant="primary" icon={<Plus />} onClick={openAsk} className="ask-button" aria-label="Ask a research question">
          <span className="ask-button-text">Ask question</span>
        </Button>
      </div>
    </header>
  )
}
