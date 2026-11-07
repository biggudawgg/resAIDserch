import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Ban, CornerDownLeft, FileText, FlaskConical, Lightbulb, Plus, Search, SunMoon, Upload, Users } from 'lucide-react'
import { useSearch } from '../../api/hooks'
import type { LinkType, SearchResult } from '../../api/types'
import { cx } from '../../lib/cx'
import { useDebounced } from '../../lib/hooks'
import { linkPath } from '../../lib/links'
import { useTheme } from '../../lib/theme'
import { useUI } from '../../lib/ui'
import { useDialog } from '../ui/Modal'
import { ALL_NAV } from './nav'

interface PaletteItem {
  id: string
  group: string
  label: string
  sublabel?: string
  icon: ReactNode
  run: () => void
}

const TYPE_META: Record<LinkType, { label: string; icon: ReactNode }> = {
  question: { label: 'Question', icon: <FlaskConical /> },
  belief: { label: 'Belief', icon: <Lightbulb /> },
  paper: { label: 'Paper', icon: <FileText /> },
  dead_end: { label: 'Dead end', icon: <Ban /> },
  meeting: { label: 'Meeting', icon: <Users /> },
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const debounced = useDebounced(query.trim(), 150)
  const search = useSearch(debounced)
  const navigate = useNavigate()
  const { openAsk } = useUI()
  const { toggle } = useTheme()
  const ref = useRef<HTMLDivElement>(null)
  useDialog(open, onClose, ref)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  const items = useMemo<PaletteItem[]>(() => {
    const go = (path: string) => {
      onClose()
      navigate(path)
    }
    const q = query.trim().toLowerCase()
    const results: PaletteItem[] =
      debounced.length >= 2
        ? (search.data ?? []).map((r: SearchResult) => ({
            id: `${r.type}-${r.id}`,
            group: 'Results',
            label: r.title,
            sublabel: `${TYPE_META[r.type].label} · ${r.subtitle}`,
            icon: TYPE_META[r.type].icon,
            run: () => go(linkPath(r.type, r.id)),
          }))
        : []
    const pages: PaletteItem[] = ALL_NAV.filter((n) => !q || n.label.toLowerCase().includes(q)).map((n) => ({
      id: `nav-${n.to}`,
      group: 'Go to',
      label: n.label,
      icon: <n.icon />,
      run: () => go(n.to),
    }))
    const actions: PaletteItem[] = [
      { id: 'act-ask', group: 'Actions', label: 'Ask a research question', icon: <Plus />, run: openAsk },
      { id: 'act-paper', group: 'Actions', label: 'Add a paper by arXiv ID', icon: <FileText />, run: () => go('/library?add=1') },
      { id: 'act-meeting', group: 'Actions', label: 'Add a meeting transcript', icon: <Upload />, run: () => go('/meetings?new=1') },
      {
        id: 'act-theme',
        group: 'Actions',
        label: 'Toggle light / dark theme',
        icon: <SunMoon />,
        run: () => {
          toggle()
          onClose()
        },
      },
    ].filter((a) => !q || a.label.toLowerCase().includes(q))
    return [...results, ...pages, ...actions]
  }, [query, debounced, search.data, navigate, onClose, openAsk, toggle])

  useEffect(() => setActive(0), [items.length])

  if (!open) return null

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(items.length - 1, i + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      items[active]?.run()
    }
  }

  let lastGroup = ''
  return createPortal(
    <div
      className="overlay overlay-top"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div ref={ref} className="palette" role="dialog" aria-modal="true" aria-label="Search and commands">
        <div className="palette-input">
          <Search aria-hidden />
          <input
            data-autofocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search or jump to…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `palette-${items[active].id}` : undefined}
            aria-autocomplete="list"
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <ul className="palette-list" id="palette-list" role="listbox" aria-label="Results">
          {items.length === 0 && <li className="palette-empty">No matches for “{query}”</li>}
          {items.map((item, index) => {
            const header = item.group !== lastGroup ? item.group : null
            lastGroup = item.group
            return (
              <li key={item.id} role="presentation">
                {header && <p className="palette-group">{header}</p>}
                <div
                  id={`palette-${item.id}`}
                  role="option"
                  aria-selected={index === active}
                  className={cx('palette-item', index === active && 'is-active')}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => item.run()}
                >
                  <span className="palette-icon" aria-hidden>
                    {item.icon}
                  </span>
                  <span className="palette-text">
                    <span className="palette-label">{item.label}</span>
                    {item.sublabel && <span className="palette-sublabel">{item.sublabel}</span>}
                  </span>
                  {index === active && <CornerDownLeft className="palette-enter" aria-hidden />}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>,
    document.body,
  )
}
