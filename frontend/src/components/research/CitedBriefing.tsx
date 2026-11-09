/**
 * The research briefing with inline citations, ported from KokonutUI's AI Inline Citations ("ai-citations",
 * Tailwind + motion).
 *
 * Original: "AI Inline Citations" v1.0.0 by @kokonutui, https://kokonutui.com/docs/ai/ai-citations
 * Copyright (c) Kokonut Labs. Licensed under the MIT License, https://github.com/kokonut-labs/kokonutui
 *
 * Changes from the original: the answer is the briefing's small markdown subset (paragraphs, **bold**, "- " lists),
 * and citations are written in it as "[2]" or "[1, 3]", 1-based positions in the run's claim list (the backend writes
 * them; the Markdown export numbers its evidence the same way). A source is a claim, not a web page: the preview shows
 * its stance, the claim and the paper it came from, and the source list opens the paper in the drawer instead of a new
 * tab. The cited span is the sentence before the marker. Styling uses CSS classes and design tokens. The shared
 * preview that glides between chips, the warm re-open, the highlighted claim, tap and keyboard support and the
 * collapsible source list are unchanged.
 */
import { Fragment, type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { ChevronDown, FileText } from 'lucide-react'
import type { Claim, Stance } from '../../api/types'
import { cx } from '../../lib/cx'
import { formatAuthors } from '../../lib/format'
import { useOpenPaper } from '../../lib/hooks'

const EASE_OUT = [0.23, 1, 0.32, 1] as const
const CARD_WIDTH = 300
const OPEN_DELAY_MS = 120
const CLOSE_DELAY_MS = 90
/** After a preview closes, the next one within this window opens at once. */
const WARM_MS = 400
/** Height to assume for a preview that hasn't been measured yet. */
const CARD_GUESS = 200
const LAST_WORD = /\S+\s*$/
const CITE = /\s*\[(\d+(?:\s*,\s*\d+)*)\]/g
const BOUNDARY = /[.!?:;]\s+/g
/** Words whose full stop doesn't end a sentence ("Patel et al. (2026)"). */
const ABBREVIATIONS = new Set(['al', 'etc', 'e.g', 'i.e', 'vs', 'cf', 'fig', 'no', 'approx'])

/**
 * Where the sentence a citation backs starts: just after the last sentence end in `before`, skipping full stops
 * inside quotes (a quoted claim is cited whole) and after abbreviations.
 */
function sentenceStart(before: string): number {
  let start = 0
  for (const m of before.matchAll(BOUNDARY)) {
    const at = m.index ?? 0
    const head = before.slice(0, at)
    const open = (head.match(/“/g) ?? []).length - (head.match(/”/g) ?? []).length
    const word = head.match(/([\w.]+)$/)?.[1].toLowerCase() ?? ''
    if (open > 0 || ABBREVIATIONS.has(word)) continue
    start = at + m[0].length
  }
  return start
}

const STANCE_TEXT: Record<Stance, string> = { supports: 'Supports', limits: 'Limits', neutral: 'Context' }

/** A run of briefing text, and the claims (0-based) that back it when it is a cited span. */
interface Span {
  text: string
  cite?: number[]
}

/** Splits one line of the briefing into plain spans and cited sentences. */
function splitLine(line: string, claimCount: number): Span[] {
  const spans: Span[] = []
  let last = 0
  for (const match of line.matchAll(CITE)) {
    const before = line.slice(last, match.index)
    const cite = match[1]
      .split(',')
      .map((n) => Number(n.trim()) - 1)
      .filter((n) => n >= 0 && n < claimCount)
    // The cited sentence starts after the last full stop (and its space); the stop stays with the plain text.
    const startAt = sentenceStart(before)
    if (startAt > 0) spans.push({ text: before.slice(0, startAt) })
    spans.push(cite.length ? { text: before.slice(startAt), cite } : { text: before.slice(startAt) })
    last = (match.index ?? 0) + match[0].length
  }
  if (last < line.length) spans.push({ text: line.slice(last) })
  return spans
}

/** **bold** inside a span. */
function inline(text: string, key: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong> : <Fragment key={`${key}-${i}`}>{part}</Fragment>,
    )
}

const surname = (claim: Claim) => {
  const first = claim.paper?.authors[0] ?? 'Source'
  return first.split(/\s+/).slice(-1)[0]
}
const chipLabel = (claim: Claim) => `${surname(claim)}${claim.paper?.year ? ` ${claim.paper.year}` : ''}`

interface Preview {
  /** Key of the cited span the chip belongs to. */
  span: string
  cite: number[]
  x: number
  y: number
  /** Opens under the chip when there is no room above it on screen. */
  below: boolean
}

/** Opens a preview after a short hover, and lets it glide from chip to chip without re-entering. */
function usePreview() {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [warm, setWarm] = useState(false)
  const openTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)
  const lastClosed = useRef(0)

  const clear = useCallback(() => {
    if (openTimer.current) window.clearTimeout(openTimer.current)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
  }, [])

  const show = useCallback(
    (next: Preview, immediate = false) => {
      clear()
      const isWarm = preview !== null || Date.now() - lastClosed.current < WARM_MS
      if (immediate || isWarm) {
        setWarm(preview !== null)
        setPreview(next)
        return
      }
      openTimer.current = window.setTimeout(() => {
        setWarm(false)
        setPreview(next)
      }, OPEN_DELAY_MS)
    },
    [preview, clear],
  )

  const hide = useCallback(
    (immediate = false) => {
      clear()
      const close = () => {
        lastClosed.current = Date.now()
        setPreview(null)
      }
      if (immediate) close()
      else closeTimer.current = window.setTimeout(close, CLOSE_DELAY_MS)
    },
    [clear],
  )

  useEffect(() => clear, [clear])
  return { preview, warm, show, hide }
}

export function CitedBriefing({ text, claims }: { text: string; claims: Claim[] }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const cardHeight = useRef(CARD_GUESS)
  const { preview, warm, show, hide } = usePreview()
  const [hoveredClaim, setHoveredClaim] = useState<number | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const previewId = useId()
  const listId = useId()
  const openPaper = useOpenPaper()

  // Blocks of the briefing: paragraphs and lists, each line split into spans.
  const blocks = useMemo(
    () =>
      text.split(/\n{2,}/).map((block) => {
        const lines = block.split('\n').filter((line) => line.trim())
        const listStart = lines.findIndex((line) => line.startsWith('- '))
        const head = listStart === -1 ? lines : lines.slice(0, listStart)
        const items = listStart === -1 ? [] : lines.slice(listStart).map((line) => line.replace(/^- /, ''))
        return { head: head.map((l) => splitLine(l, claims.length)), items: items.map((l) => splitLine(l, claims.length)) }
      }),
    [text, claims.length],
  )

  // Claims numbered as the briefing cites them, for the source list.
  const cited = useMemo(() => {
    const order: number[] = []
    for (const block of blocks)
      for (const line of [...block.head, ...block.items]) for (const span of line) for (const n of span.cite ?? []) if (!order.includes(n)) order.push(n)
    return order
  }, [blocks])

  const place = (key: string, cite: number[], chip: HTMLElement): Preview => {
    const root = rootRef.current?.getBoundingClientRect()
    const rect = chip.getBoundingClientRect()
    const width = Math.min(CARD_WIDTH, root?.width ?? CARD_WIDTH)
    const left = rect.left - (root?.left ?? 0) + rect.width / 2 - width / 2
    const max = (root?.width ?? width) - width
    // Under the sticky top bar there is no room above: open below instead.
    const below = rect.top < cardHeight.current + 72
    return {
      span: key,
      cite,
      x: Math.min(Math.max(0, left), Math.max(0, max)),
      y: below ? rect.bottom - (root?.top ?? 0) + 8 : rect.top - (root?.top ?? 0) - 8,
      below,
    }
  }

  // Remember how tall the open preview is, to decide the next one's side.
  useLayoutEffect(() => {
    if (preview && cardRef.current) cardHeight.current = cardRef.current.offsetHeight
  })

  // Escape, or a press anywhere but a chip, closes a preview opened by keyboard or tap.
  useEffect(() => {
    if (!preview) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide(true)
    }
    const onPointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element && event.target.closest('[data-citation-chip]'))) hide(true)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [preview, hide])

  const renderLine = (spans: Span[], lineKey: string) =>
    spans.map((span, i) => {
      const key = `${lineKey}-${i}`
      if (!span.cite) return <Fragment key={key}>{inline(span.text, key)}</Fragment>
      const cite = span.cite
      const first = claims[cite[0]]
      const isActive = preview?.span === key
      const isLinked = hoveredClaim !== null && cite.includes(hoveredClaim)
      const lit = isActive || isLinked
      // The last word rides with the chip, so a chip never starts a line on its own.
      const tail = span.text.match(LAST_WORD)?.[0].trimEnd() ?? ''
      const head = span.text.slice(0, span.text.length - tail.length)
      return (
        <span key={key}>
          {head && <span className={cx('cite-claim', lit && 'is-lit')}>{inline(head, `${key}-h`)}</span>}
          <span className="cite-nowrap">
            {tail && <span className={cx('cite-claim', lit && 'is-lit')}>{inline(tail, `${key}-t`)}</span>}
            {' '}
            <button
              aria-describedby={isActive ? previewId : undefined}
              aria-label={`Sources: ${cite.map((n) => `claim ${n + 1}, ${chipLabel(claims[n])}`).join('; ')}`}
              className={cx('cite-chip', lit && 'is-lit')}
              data-citation-chip=""
              onBlur={() => hide(true)}
              // Focus already opened it for mouse and keyboard; a tap on touch opens it here.
              onClick={(event) => show(place(key, cite, event.currentTarget), true)}
              onFocus={(event) => show(place(key, cite, event.currentTarget), true)}
              onPointerEnter={(event) => {
                if (event.pointerType === 'mouse') show(place(key, cite, event.currentTarget))
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === 'mouse') hide()
              }}
              type="button"
            >
              <span aria-hidden className={cx('cite-mono', `stance-${first.stance}`)}>
                {surname(first).charAt(0)}
              </span>
              {chipLabel(first)}
              {cite.length > 1 && <span className="cite-more">+{cite.length - 1}</span>}
            </button>
          </span>
        </span>
      )
    })

  const activeClaims = (preview?.cite ?? []).map((n) => ({ n, claim: claims[n] }))

  return (
    <MotionConfig reducedMotion="user">
      <div className="cite-root" ref={rootRef}>
        <div className="prose">
          {blocks.map((block, bi) => (
            <Fragment key={bi}>
              {block.head.length > 0 && (
                <p>
                  {block.head.map((line, li) => (
                    <Fragment key={li}>
                      {li > 0 && <br />}
                      {renderLine(line, `${bi}-${li}`)}
                    </Fragment>
                  ))}
                </p>
              )}
              {block.items.length > 0 && (
                <ul>
                  {block.items.map((line, ii) => (
                    <li key={ii}>{renderLine(line, `${bi}-i${ii}`)}</li>
                  ))}
                </ul>
              )}
            </Fragment>
          ))}
        </div>

        {/* One preview for every chip. It glides between chips once open, and fades in fresh after a pause. */}
        <AnimatePresence>
          {preview && activeClaims.length > 0 && (
            <motion.div
              animate={{ opacity: 1, scale: 1, x: preview.x, y: preview.y }}
              className="cite-preview"
              exit={{ opacity: 0, scale: 0.97 }}
              id={previewId}
              initial={{ opacity: 0, scale: 0.97, x: preview.x, y: preview.y }}
              role="tooltip"
              style={{ transformOrigin: '50% 0%', width: Math.min(CARD_WIDTH, rootRef.current?.offsetWidth ?? CARD_WIDTH) }}
              transition={{
                opacity: { duration: 0.14, ease: EASE_OUT },
                scale: { duration: 0.14, ease: EASE_OUT },
                x: warm ? { duration: 0.22, ease: EASE_OUT } : { duration: 0 },
                y: warm ? { duration: 0.22, ease: EASE_OUT } : { duration: 0 },
              }}
            >
              <div className={cx('cite-card', !preview.below && 'is-above')} ref={cardRef}>
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.div
                    animate={{ opacity: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, filter: 'blur(2px)' }}
                    initial={{ opacity: 0, filter: 'blur(2px)' }}
                    key={preview.span}
                    transition={{ duration: 0.16, ease: EASE_OUT }}
                  >
                    {activeClaims.map(({ n, claim }) => (
                      <div className="cite-source" key={claim.id}>
                        <div className="cite-source-head">
                          <span className={cx('cite-stance', `stance-${claim.stance}`)}>{STANCE_TEXT[claim.stance]}</span>
                          <span className="cite-kind">{claim.kind === 'quote' ? 'Verbatim from the abstract' : 'Summary of the paper'}</span>
                          <span className="cite-n">{n + 1}</span>
                        </div>
                        <p className="cite-text">{claim.kind === 'quote' ? `“${claim.text}”` : claim.text}</p>
                        {claim.paper && (
                          <p className="cite-paper">
                            {claim.paper.title}
                            <span>
                              {' '}
                              · {formatAuthors(claim.paper.authors, claim.paper.etAl)}, {claim.paper.year ?? 'n.d.'}
                            </span>
                          </p>
                        )}
                      </div>
                    ))}
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {cited.length > 0 && (
          <div className="cite-list-wrap">
            <button aria-controls={listId} aria-expanded={listOpen} className="cite-list-toggle" onClick={() => setListOpen((open) => !open)} type="button">
              <span className="cite-stack">
                {cited.slice(0, 4).map((n) => (
                  <span aria-hidden className={cx('cite-mono', 'is-stacked', `stance-${claims[n].stance}`)} key={n}>
                    {surname(claims[n]).charAt(0)}
                  </span>
                ))}
              </span>
              {cited.length} cited {cited.length === 1 ? 'claim' : 'claims'}
              <ChevronDown aria-hidden className={cx('cite-chevron', listOpen && 'is-open')} />
            </button>
            <AnimatePresence initial={false}>
              {listOpen && (
                <motion.ol
                  animate={{ height: 'auto', opacity: 1 }}
                  className="cite-list"
                  exit={{ height: 0, opacity: 0 }}
                  id={listId}
                  initial={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: EASE_OUT }}
                >
                  {cited.map((n) => {
                    const claim = claims[n]
                    return (
                      <li key={claim.id}>
                        <button
                          className="cite-list-row"
                          disabled={!claim.paper}
                          onBlur={() => setHoveredClaim(null)}
                          onClick={() => claim.paper && openPaper(claim.paper.id)}
                          onFocus={() => setHoveredClaim(n)}
                          onPointerEnter={() => setHoveredClaim(n)}
                          onPointerLeave={() => setHoveredClaim(null)}
                          type="button"
                        >
                          <span className="cite-list-n">{n + 1}</span>
                          <span className={cx('cite-mono', `stance-${claim.stance}`)} aria-hidden>
                            {surname(claim).charAt(0)}
                          </span>
                          <span className="cite-list-text">{claim.text}</span>
                          <span className="cite-list-paper">
                            <FileText aria-hidden />
                            {chipLabel(claim)}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </motion.ol>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </MotionConfig>
  )
}
