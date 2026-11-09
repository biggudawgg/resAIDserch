/**
 * Action Search (command palette), ported from KokonutUI's Action Search Bar (Tailwind + motion) to this app's CSS.
 *
 * Original: "Action Search Bar" v2.0.0 by @kokonutui, https://kokonutui.com/docs/navigation/action-search-bar
 * Copyright (c) Kokonut Labs. Licensed under the MIT License, https://github.com/kokonut-labs/kokonutui
 *
 * Changes from the original: always open (the host shows it in an overlay, so it also works on phones); a `results`
 * prop adds live search rows that skip fuzzy filtering; recent commands persist per browser; rows can carry a tone
 * for a coloured icon tile; styling uses CSS classes and design tokens.
 */
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ArrowUpRight, Check, ChevronRight, LoaderCircle, Search } from 'lucide-react'
import { animate, useReducedMotion } from 'motion/react'
import { cx } from '../../lib/cx'

export type CommandTone = 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'teal' | 'neutral'

export interface CommandItem {
  id: string
  label: string
  /** Small grey text after the label, e.g. a result's type. */
  hint?: string
  icon?: ReactNode
  /** Colour of the icon tile. */
  tone?: CommandTone
  /** Section heading on its page, such as "Actions" or "Go to". */
  group?: string
  /** Extra words the row matches on, without being shown. */
  keywords?: string[]
  /** Keys shown at the end of the row, such as ["G", "R"]. */
  shortcut?: string[]
  /** Marks the row as a link (shows an arrow). `onSelect` decides how to open it. */
  href?: string
  /** Choosing the row opens these as a nested page instead of running it. */
  children?: CommandItem[]
  /** Input placeholder while this item's page is open. */
  placeholder?: string
}

interface Entry {
  item: CommandItem
  /** Ancestors below the current page, shown as a "Parent ›" prefix. */
  path: CommandItem[]
}

interface Row extends Entry {
  key: string
  matches: number[]
  score: number
}

interface Section {
  key: string
  label?: string
  rows: Row[]
}

type InputSource = 'keyboard' | 'pointer'

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'
const HOLD_MS = 400
const RECENT_LIMIT = 3

/* ---------------------------------------------------------------- matching */

const WORD_BREAK = /[\s\-_/.]/
const WHITESPACE = /\s+/g

const isWordStart = (text: string, i: number) => i === 0 || WORD_BREAK.test(text[i - 1] ?? '')

/** The first word start at or after `from` that holds `ch`, else `from`. */
function nextWordStart(t: string, ch: string, from: number) {
  for (let j = from; j < t.length; j++) if (t[j] === ch && isWordStart(t, j)) return j
  return from
}

function subsequence(t: string, q: string, preferWordStarts: boolean) {
  const matches: number[] = []
  let score = 0
  let from = 0
  for (const ch of q) {
    let i = t.indexOf(ch, from)
    if (i < 0) return null
    const prev = matches.length ? matches[matches.length - 1] : undefined
    // Unless it continues a run, jump ahead to a word start holding `ch`.
    if (preferWordStarts && (prev === undefined || i !== prev + 1)) i = nextWordStart(t, ch, i)
    score += prev !== undefined && i === prev + 1 ? 6 : 1
    score += isWordStart(t, i) ? 8 : 0
    score -= prev === undefined ? i * 0.5 : (i - prev - 1) * 0.2
    matches.push(i)
    from = i + 1
  }
  return { score, matches }
}

/** Fuzzy match favouring contiguous runs, word starts and early matches; null when `query` is not a subsequence. */
function fuzzyMatch(text: string, query: string): { score: number; matches: number[] } | null {
  const t = text.toLowerCase()
  const q = query.toLowerCase().replace(WHITESPACE, '')
  if (!q) return { score: 0, matches: [] }
  const at = t.indexOf(q)
  if (at >= 0) {
    const matches = Array.from({ length: q.length }, (_, k) => at + k)
    return { score: 100 - at + (isWordStart(t, at) ? 30 : 0), matches }
  }
  return subsequence(t, q, true) ?? subsequence(t, q, false)
}

function scoreEntry(entry: Entry, query: string) {
  const onLabel = fuzzyMatch(entry.item.label, query)
  if (onLabel) return onLabel
  // Parent labels and keywords still find the row, ranked lower, unbolded.
  const extra = [...entry.path.map((p) => p.label), ...(entry.item.keywords ?? [])]
  let best: number | null = null
  for (const word of extra) {
    const hit = fuzzyMatch(word, query)
    if (hit && (best === null || hit.score > best)) best = hit.score
  }
  return best === null ? null : { score: best / 2, matches: [] }
}

/* ---------------------------------------------------------------- sections */

function flatten(items: CommandItem[], path: CommandItem[] = []): Entry[] {
  const out: Entry[] = []
  for (const item of items) {
    out.push({ item, path })
    if (item.children) out.push(...flatten(item.children, [...path, item]))
  }
  return out
}

function groupRows(rows: Row[], fallback?: string): Section[] {
  const byGroup = new Map<string, Row[]>()
  for (const row of rows) {
    const label = row.path[0]?.group ?? row.item.group ?? fallback ?? ''
    const list = byGroup.get(label) ?? []
    list.push(row)
    byGroup.set(label, list)
  }
  return [...byGroup].map(([label, list]) => ({ key: label || 'items', label: label || undefined, rows: list }))
}

function buildSections(page: CommandItem | undefined, rootItems: CommandItem[], query: string, recent: Entry[], results: CommandItem[]): Section[] {
  const items = page?.children ?? rootItems
  const fallback = page?.label

  if (!query.trim()) {
    const rows = items.map<Row>((item) => ({ item, path: [], key: item.id, matches: [], score: 0 }))
    const sections = groupRows(rows, fallback)
    if (!page && recent.length > 0) {
      sections.unshift({
        key: 'recent',
        label: 'Recent',
        rows: recent.map((e) => ({ ...e, key: `recent-${e.item.id}`, matches: [], score: 0 })),
      })
    }
    return sections
  }

  // Searching from a page also reaches the rows nested inside it.
  const rows: Row[] = []
  for (const entry of flatten(items)) {
    const hit = scoreEntry(entry, query)
    if (hit) rows.push({ ...entry, key: entry.item.id, ...hit })
  }
  const sections = groupRows(rows, fallback)
  for (const section of sections) section.rows.sort((a, b) => b.score - a.score)
  // Live results are already matched by the server: keep its order, highlight what we can.
  if (!page && results.length) {
    sections.unshift({
      key: 'results',
      label: 'Results',
      rows: results.map((item) => ({ item, path: [], key: item.id, matches: fuzzyMatch(item.label, query)?.matches ?? [], score: 0 })),
    })
  }
  return sections
}

function findEntry(items: CommandItem[], id: string): Entry | undefined {
  return flatten(items).find((e) => e.item.id === id)
}

function readRecent(key: string | undefined): string[] {
  if (!key) return []
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function writeRecent(key: string | undefined, ids: string[]) {
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    /* storage unavailable: recents last for this session only */
  }
}

/* ---------------------------------------------------------------- pieces */

function Highlighted({ text, matches }: { text: string; matches: number[] }) {
  if (matches.length === 0) return <>{text}</>
  const hit = new Set(matches)
  const parts: { start: number; text: string; on: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const on = hit.has(i)
    const last = parts[parts.length - 1]
    if (last && last.on === on) last.text += text[i]
    else parts.push({ start: i, text: text[i] ?? '', on })
  }
  return (
    <>
      {parts.map((p) =>
        p.on ? (
          <b className="asearch-hit" key={p.start}>
            {p.text}
          </b>
        ) : (
          <span key={p.start}>{p.text}</span>
        ),
      )}
    </>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="asearch-kbd">{children}</kbd>
}

function RowEnd({ item, status }: { item: CommandItem; status: 'pending' | 'done' | undefined }) {
  if (status === 'pending') return <LoaderCircle aria-hidden className="asearch-end spin" />
  if (status === 'done') return <Check aria-hidden className="asearch-end is-done" />
  if (item.children) return <ChevronRight aria-hidden className="asearch-end" />
  if (item.href) return <ArrowUpRight aria-hidden className="asearch-end" />
  if (item.shortcut) {
    return (
      <span aria-hidden className="asearch-keys">
        {item.shortcut.map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </span>
    )
  }
  return null
}

/* ---------------------------------------------------------------- palette */

export function ActionSearch({
  items,
  results = [],
  onQueryChange,
  onSelect,
  onClose,
  recentKey,
  loading = false,
  label = 'Search and run commands',
  placeholder = 'Search or jump to…',
}: {
  items: CommandItem[]
  /** Live results for the current query, shown first under "Results". */
  results?: CommandItem[]
  onQueryChange?: (query: string) => void
  /** Called when a row without children is chosen. Return a Promise to show a spinner in the row until it settles. */
  onSelect: (item: CommandItem, path: CommandItem[]) => unknown
  onClose: () => void
  /** localStorage key for recent commands; omit to keep none. */
  recentKey?: string
  /** Live results are on their way. */
  loading?: boolean
  label?: string
  placeholder?: string
}) {
  const uid = useId()
  const inputId = `${uid}-input`
  const listboxId = `${uid}-listbox`
  const optionId = useCallback((index: number) => `${uid}-option-${index}`, [uid])

  const reduce = useReducedMotion()

  const [query, setQuery] = useState('')
  const [stack, setStack] = useState<CommandItem[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [running, setRunning] = useState<{ key: string; phase: 'pending' | 'done' } | null>(null)
  const [recentIds, setRecentIds] = useState(() => readRecent(recentKey))
  const [announcement, setAnnouncement] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const slideNext = useRef<0 | 1 | -1>(0)
  const springUntil = useRef(0)
  const holdTimer = useRef<number | undefined>(undefined)
  const runToken = useRef(0)

  const page = stack.length ? stack[stack.length - 1] : undefined
  const recent = useMemo(
    () =>
      recentIds
        .map((id) => findEntry(items, id))
        .filter((e): e is Entry => e !== undefined && !e.item.children)
        .slice(0, RECENT_LIMIT),
    [recentIds, items],
  )
  const sections = useMemo(() => buildSections(page, items, query, recent, results), [page, items, query, recent, results])
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections])
  const highlighted = Math.min(activeIndex, rows.length - 1)
  const activeRow = rows[highlighted]

  useEffect(() => {
    inputRef.current?.focus()
    const timer = holdTimer
    return () => window.clearTimeout(timer.current)
  }, [])

  useEffect(() => {
    onQueryChange?.(page ? '' : query)
  }, [query, page, onQueryChange])

  /* -- motion: the panel's height springs to its content after a pointer page change -- */

  useLayoutEffect(() => {
    const body = bodyRef.current
    const content = contentRef.current
    if (!(body && content)) return
    let controls: ReturnType<typeof animate> | undefined
    const fitHeight = () => {
      const h = `${content.offsetHeight}px`
      controls?.stop()
      if (!reduce && performance.now() < springUntil.current) {
        controls = animate(body, { height: h }, { type: 'spring', bounce: 0, duration: 0.32 })
      } else {
        body.style.height = h
      }
    }
    fitHeight()
    const ro = new ResizeObserver(fitHeight)
    ro.observe(content)
    return () => {
      ro.disconnect()
      controls?.stop()
    }
  }, [reduce])

  // Slide the list in from the side the user is moving toward.
  useLayoutEffect(() => {
    const list = listRef.current
    const dir = slideNext.current
    slideNext.current = 0
    if (!list || dir === 0) return
    list.animate(
      [
        { transform: reduce ? 'none' : `translateX(${dir * 14}px)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 200, easing: EASE_OUT },
    )
  }, [stack.length, reduce])

  // Keep the highlighted row inside the list's scroll box (never the page).
  useLayoutEffect(() => {
    const list = listRef.current
    const row = document.getElementById(optionId(highlighted))
    if (!(list && row)) return
    const top = row.offsetTop
    const bottom = top + row.offsetHeight
    if (top < list.scrollTop + 6) list.scrollTop = top - 30
    else if (bottom > list.scrollTop + list.clientHeight - 6) list.scrollTop = bottom - list.clientHeight + 6
  }, [highlighted, sections, optionId])

  /* -- pages -- */

  const pushPage = (item: CommandItem, source: InputSource) => {
    slideNext.current = 1
    if (source === 'pointer') springUntil.current = performance.now() + 150
    setStack((s) => [...s, item])
    setQuery('')
    setActiveIndex(0)
    setAnnouncement(`${item.label}, ${item.children?.length ?? 0} options`)
  }

  const popPage = (source: InputSource) => {
    const left = stack[stack.length - 1]
    if (!left) return
    slideNext.current = -1
    if (source === 'pointer') springUntil.current = performance.now() + 150
    const nextStack = stack.slice(0, -1)
    setStack(nextStack)
    setQuery('')
    // Land back on the row that opened the page.
    const back = buildSections(nextStack[nextStack.length - 1], items, '', recent, [])
      .flatMap((s) => s.rows)
      .findIndex((r) => r.key === left.id)
    setActiveIndex(Math.max(0, back))
    setAnnouncement(nextStack[nextStack.length - 1]?.label ?? 'All commands')
    inputRef.current?.focus()
  }

  /* -- running -- */

  const finishRun = (row: Row, token: number) => {
    if (token !== runToken.current) return
    setRunning({ key: row.key, phase: 'done' })
    setAnnouncement(`${row.item.label}, done`)
    holdTimer.current = window.setTimeout(() => {
      if (token !== runToken.current) return
      // Live results are not commands: they never become recents. Written now, because closing unmounts us.
      if (!row.key.startsWith('result-')) {
        const next = [row.item.id, ...recentIds.filter((id) => id !== row.item.id)].slice(0, RECENT_LIMIT)
        writeRecent(recentKey, next)
        setRecentIds(next)
      }
      onClose()
    }, HOLD_MS)
  }

  const runRow = (row: Row) => {
    runToken.current += 1
    const token = runToken.current
    const result = onSelect(row.item, [...stack, ...row.path])
    if (!(result instanceof Promise)) {
      finishRun(row, token)
      return
    }
    setRunning({ key: row.key, phase: 'pending' })
    setAnnouncement(`Running ${row.item.label}`)
    result.then(
      () => finishRun(row, token),
      () => {
        if (token === runToken.current) {
          setRunning(null)
          setAnnouncement(`${row.item.label} failed`)
        }
      },
    )
  }

  const choose = (row: Row, source: InputSource) => {
    if (running) return
    if (row.item.children) pushPage(row.item, source)
    else runRow(row)
  }

  /* -- input -- */

  const moveHighlight = (step: number) => {
    const count = rows.length
    if (count > 0) setActiveIndex((Math.max(highlighted, 0) + step + count) % count)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (running && e.key !== 'Tab') {
      e.preventDefault()
      return
    }
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault()
        moveHighlight(e.key === 'ArrowDown' ? 1 : -1)
        break
      case 'Home':
      case 'End':
        if (rows.length) {
          e.preventDefault()
          setActiveIndex(e.key === 'Home' ? 0 : rows.length - 1)
        }
        break
      case 'Enter':
        e.preventDefault()
        if (activeRow) choose(activeRow, 'keyboard')
        break
      case 'Backspace':
        if (query === '' && stack.length > 0) {
          e.preventDefault()
          popPage('keyboard')
        }
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        if (query) setQuery('')
        else onClose()
        break
      default:
        break
    }
  }

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value)
    setActiveIndex(0)
  }

  const pagePlaceholder = page ? (page.placeholder ?? `Search ${page.label.toLowerCase()}…`) : placeholder
  let rowIndex = -1

  return (
    <div className="asearch">
      <div className="asearch-bar">
        <Search aria-hidden className="asearch-icon" />
        {stack.map((p, i) => (
          <button
            aria-label={`Back from ${p.label}`}
            className="asearch-crumb"
            key={p.id}
            onClick={() => {
              if (i === stack.length - 1 && !running) popPage('pointer')
            }}
            // Keep focus in the input; Backspace is the keyboard path.
            onPointerDown={(e) => e.preventDefault()}
            tabIndex={-1}
            type="button"
          >
            {p.label}
          </button>
        ))}
        <label className="sr-only" htmlFor={inputId}>
          {label}
        </label>
        <input
          aria-activedescendant={activeRow ? optionId(highlighted) : undefined}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded
          autoComplete="off"
          className="asearch-input"
          id={inputId}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={pagePlaceholder}
          readOnly={running !== null}
          ref={inputRef}
          role="combobox"
          spellCheck={false}
          type="text"
          value={query}
        />
        {loading && <LoaderCircle aria-hidden className="asearch-icon spin" />}
      </div>

      {/* Keep focus in the input while pressing inside the list. */}
      <div onPointerDown={(e) => e.preventDefault()}>
        <div className="asearch-body" ref={bodyRef}>
          <div ref={contentRef}>
            <div
              aria-busy={running?.phase === 'pending'}
              aria-label={page ? page.label : 'Commands'}
              className="asearch-list"
              id={listboxId}
              ref={listRef}
              role="listbox"
            >
              {sections.map((section) => (
                <div aria-labelledby={section.label ? `${uid}-${section.key}` : undefined} key={section.key} role="group">
                  {section.label && (
                    <div className="asearch-group" id={`${uid}-${section.key}`} role="presentation">
                      {section.label}
                    </div>
                  )}
                  {section.rows.map((row) => {
                    rowIndex += 1
                    const index = rowIndex
                    const status = running?.key === row.key ? running.phase : undefined
                    return (
                      <div
                        aria-disabled={running !== null && !status}
                        aria-selected={index === highlighted}
                        className="asearch-row"
                        id={optionId(index)}
                        key={row.key}
                        onClick={() => choose(row, 'pointer')}
                        onPointerMove={(e) => {
                          if (e.pointerType === 'mouse' && !running && index !== highlighted) setActiveIndex(index)
                        }}
                        role="option"
                      >
                        <span aria-hidden className={cx('asearch-tile', `tone-${row.item.tone ?? 'neutral'}`)}>
                          {row.item.icon}
                        </span>
                        <span className="asearch-label">
                          {row.path.map((p) => (
                            <span className="asearch-path" key={p.id}>
                              {p.label}
                              <span aria-hidden> › </span>
                            </span>
                          ))}
                          <Highlighted matches={row.matches} text={row.item.label} />
                          {row.item.hint && <span className="asearch-hint"> · {row.item.hint}</span>}
                          {row.item.children && <span className="sr-only">, opens a page</span>}
                        </span>
                        <span className="asearch-row-end">
                          <RowEnd item={row.item} status={status} />
                        </span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            {rows.length === 0 && <p className="asearch-empty">{loading ? 'Searching…' : `No results for “${query.trim()}”`}</p>}
          </div>
        </div>
        <div className="asearch-foot">
          <span className="asearch-foot-group">
            <span className="asearch-foot-nav">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span>Navigate</span>
            </span>
            <Kbd>↵</Kbd>
            <span>{activeRow?.item.children ? 'Open' : 'Run'}</span>
          </span>
          <span className="asearch-foot-group">
            {stack.length > 0 && (
              <>
                <Kbd>⌫</Kbd>
                <span>Back</span>
              </>
            )}
            <Kbd>esc</Kbd>
            <span>Close</span>
          </span>
        </div>
      </div>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  )
}
