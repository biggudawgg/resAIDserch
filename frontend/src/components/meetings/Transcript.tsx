import { useEffect, useRef } from 'react'
import { Mark, MarkerText } from '../ui/MarkerText'

/** Finds where a stance's quote sits in a line, tolerating curly quotes and spacing differences. */
function locate(line: string, quote: string): [number, number] | null {
  const norm = (text: string) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').toLowerCase()
  const at = norm(line).indexOf(norm(quote).trim())
  // The normalising keeps lengths the same except for collapsed spaces, which transcripts rarely have.
  return at === -1 ? null : [at, at + quote.trim().length]
}

/**
 * A meeting transcript, one speaker turn per line. When `focus` names a quote, the transcript opens, scrolls the
 * line into view and draws over the quote with a highlighter (MarkerText), so a stance can be checked against what
 * was actually said.
 */
export function Transcript({
  text,
  focus,
  open,
  setOpen,
  onToggle,
}: {
  text: string
  focus: { quote: string; nonce: number } | null
  open: boolean
  setOpen: (open: boolean) => void
  onToggle: (open: boolean) => void
}) {
  const lineRef = useRef<HTMLLIElement>(null)
  const lines = text.split('\n').filter((l) => l.trim())
  const target = focus ? lines.findIndex((l) => locate(l, focus.quote)) : -1

  useEffect(() => {
    if (!focus || target < 0) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Wait a frame for the details element to open before scrolling.
    const frame = requestAnimationFrame(() => lineRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' }))
    return () => cancelAnimationFrame(frame)
  }, [focus, target])

  return (
    <details
      className="transcript-details"
      onToggle={(event) => {
        const isOpen = event.currentTarget.open
        setOpen(isOpen)
        onToggle(isOpen)
      }}
      open={open}
    >
      <summary>{open ? 'Hide the transcript' : 'Show the full transcript'}</summary>
      <ol className="transcript-lines">
        {lines.map((line, i) => {
          const colon = line.indexOf(':')
          const speaker = colon > 0 && colon < 40 ? line.slice(0, colon) : null
          const said = speaker ? line.slice(colon + 1).trimStart() : line
          const span = focus && i === target ? locate(said, focus.quote) : null
          return (
            <li className={i === target ? 'is-target' : undefined} key={i} ref={i === target ? lineRef : undefined}>
              {speaker && <span className="transcript-speaker">{speaker}</span>}
              {span ? (
                // Keyed by the click, so the highlighter draws again each time.
                <MarkerText className="transcript-said" key={focus?.nonce} show>
                  {said.slice(0, span[0])}
                  <Mark>{said.slice(span[0], span[1])}</Mark>
                  {said.slice(span[1])}
                </MarkerText>
              ) : (
                <span className="transcript-said">{said}</span>
              )}
            </li>
          )
        })}
      </ol>
    </details>
  )
}
