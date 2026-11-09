import { useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  Cpu,
  FileText,
  FlaskConical,
  FlaskRound,
  Gauge,
  Laptop,
  Lightbulb,
  Moon,
  Plus,
  Sun,
  SunMoon,
  Upload,
  Users,
} from 'lucide-react'
import { api } from '../../api/client'
import { useRouting, useSearch } from '../../api/hooks'
import type { LinkType, Priority } from '../../api/types'
import { useDebounced } from '../../lib/hooks'
import { linkPath } from '../../lib/links'
import { PRIORITY_META } from '../../lib/providers'
import { useTheme, type ThemeMode } from '../../lib/theme'
import { useUI } from '../../lib/ui'
import { ActionSearch, type CommandItem, type CommandTone } from '../ui/ActionSearch'
import { useDialog } from '../ui/Modal'
import { ALL_NAV } from './nav'

const TYPE_META: Record<LinkType, { label: string; icon: typeof FlaskConical; tone: CommandTone }> = {
  question: { label: 'Question', icon: FlaskConical, tone: 'blue' },
  belief: { label: 'Belief', icon: Lightbulb, tone: 'green' },
  paper: { label: 'Paper', icon: FileText, tone: 'amber' },
  dead_end: { label: 'Dead end', icon: Ban, tone: 'red' },
  meeting: { label: 'Meeting', icon: Users, tone: 'violet' },
}

const NAV_TONE: Record<string, CommandTone> = {
  '/': 'neutral',
  '/research': 'blue',
  '/beliefs': 'green',
  '/dead-ends': 'red',
  '/library': 'amber',
  '/meetings': 'violet',
  '/providers': 'teal',
  '/settings': 'neutral',
}

/** Keys after "G" that jump to a page from the palette's hint column. */
const NAV_KEY: Record<string, string> = { '/': 'O', '/research': 'R', '/beliefs': 'B', '/library': 'L', '/providers': 'P' }

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialog(open, onClose, ref)
  if (!open) return null
  return createPortal(
    <div
      className="overlay overlay-top asearch-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div ref={ref} className="asearch-dialog" role="dialog" aria-modal="true" aria-label="Search and commands">
        <PaletteBody onClose={onClose} />
      </div>
    </div>,
    document.body,
  )
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { openAsk, toast } = useUI()
  const { mode, setMode } = useTheme()
  const routing = useRouting()
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query.trim(), 150)
  const search = useSearch(debounced)

  const results = useMemo<CommandItem[]>(
    () =>
      debounced.length >= 2
        ? (search.data ?? []).slice(0, 8).map((r) => {
            const meta = TYPE_META[r.type]
            const Icon = meta.icon
            return {
              id: `result-${r.type}-${r.id}`,
              label: r.title,
              hint: meta.label,
              icon: <Icon />,
              tone: meta.tone,
              href: linkPath(r.type, r.id),
            }
          })
        : [],
    [debounced, search.data],
  )

  const items = useMemo<CommandItem[]>(() => {
    const priority = routing.data?.priority
    const themeRow = (id: ThemeMode, label: string, icon: JSX.Element): CommandItem => ({
      id: `theme-${id}`,
      label: mode === id ? `${label} (current)` : label,
      icon,
      tone: 'neutral',
    })
    return [
      { id: 'act-ask', label: 'Ask a research question', icon: <Plus />, tone: 'green', group: 'Actions', keywords: ['new', 'question', 'research'] },
      { id: 'act-paper', label: 'Add a paper by arXiv ID', icon: <FileText />, tone: 'amber', group: 'Actions', keywords: ['import', 'library'] },
      { id: 'act-meeting', label: 'Add a meeting transcript', icon: <Upload />, tone: 'violet', group: 'Actions', keywords: ['upload', 'notes'] },
      {
        id: 'act-routing',
        label: 'Change provider routing…',
        icon: <Gauge />,
        tone: 'teal',
        group: 'Actions',
        keywords: ['priority', 'quality', 'speed', 'cost', 'providers'],
        placeholder: 'Optimise for…',
        children: (Object.keys(PRIORITY_META) as Priority[]).map((p) => ({
          id: `routing-${p}`,
          label: priority === p ? `${PRIORITY_META[p].label} (current)` : PRIORITY_META[p].label,
          icon: <Cpu />,
          tone: 'teal' as CommandTone,
        })),
      },
      {
        id: 'act-theme',
        label: 'Change theme…',
        icon: <SunMoon />,
        tone: 'neutral',
        group: 'Actions',
        keywords: ['appearance', 'dark', 'light', 'mode'],
        placeholder: 'Choose a theme…',
        children: [themeRow('light', 'Light', <Sun />), themeRow('dark', 'Dark', <Moon />), themeRow('system', 'Match system', <Laptop />)],
      },
      { id: 'act-demo', label: 'About this demo', icon: <FlaskRound />, tone: 'neutral', group: 'Actions', keywords: ['help', 'info'] },
      ...ALL_NAV.map<CommandItem>((n) => ({
        id: `nav-${n.to}`,
        label: n.label,
        icon: <n.icon />,
        tone: NAV_TONE[n.to] ?? 'neutral',
        group: 'Go to',
        href: n.to,
        shortcut: NAV_KEY[n.to] ? ['G', NAV_KEY[n.to]] : undefined,
      })),
    ]
  }, [mode, routing.data?.priority])

  const onSelect = useCallback(
    (item: CommandItem) => {
      if (item.href) {
        navigate(item.href)
        return
      }
      if (item.id.startsWith('theme-')) {
        setMode(item.id.slice('theme-'.length) as ThemeMode)
        return
      }
      if (item.id.startsWith('routing-')) {
        const priority = item.id.slice('routing-'.length) as Priority
        // A real API call: the row shows a spinner until it settles, then a check.
        return api.saveRouting({ priority }).then((saved) => {
          queryClient.setQueryData(['routing'], saved)
          toast(`Routing set to ${PRIORITY_META[priority].label}`)
        })
      }
      switch (item.id) {
        case 'act-ask':
          // Let the palette close first so the modal takes focus cleanly.
          window.setTimeout(openAsk, 420)
          return
        case 'act-paper':
          navigate('/library?add=1')
          return
        case 'act-meeting':
          navigate('/meetings?new=1')
          return
        case 'act-demo':
          window.setTimeout(() => window.dispatchEvent(new CustomEvent('resaidserch:demo-info')), 420)
          return
      }
    },
    [navigate, setMode, queryClient, toast, openAsk],
  )

  return (
    <ActionSearch
      items={items}
      loading={debounced.length >= 2 && search.isFetching}
      onClose={onClose}
      onQueryChange={setQuery}
      onSelect={onSelect}
      placeholder="Search or run a command…"
      recentKey="resaidserch.palette-recent"
      results={results}
    />
  )
}
