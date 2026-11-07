const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['minute', 60],
  ['hour', 3600],
  ['day', 86400],
  ['week', 604800],
  ['month', 2629800],
  ['year', 31557600],
]

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = (new Date(iso).getTime() - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (abs < 45) return 'just now'
  let unit: Intl.RelativeTimeFormatUnit = 'minute'
  let value = diff / 60
  for (const [u, seconds] of UNITS) {
    if (abs >= seconds) {
      unit = u
      value = diff / seconds
    }
  }
  return relative.format(Math.round(value), unit)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatShortDate(iso: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function formatUsd(value: number): string {
  if (value === 0) return '$0.00'
  if (value > 0 && value < 0.01) return '<$0.01'
  return usd.format(value)
}

export function formatUsdPrecise(value: number): string {
  if (value === 0) return '$0'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return usd.format(value)
}

const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function compact(value: number): string {
  return compactFmt.format(value)
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function formatAuthors(authors: string[], etAl?: boolean): string {
  if (!authors.length) return 'Unknown authors'
  if (etAl || authors.length > 2) return `${authors[0]} et al.`
  return authors.join(' and ')
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}

export function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** "KIVI: A Tuning-Free Asymmetric…" → "KIVI"; long titles without a colon are clipped. */
export function shortTitle(title: string, max = 44): string {
  const head = title.split(':')[0].trim()
  const base = head.length >= 3 && head.length < title.length ? head : title
  return base.length > max ? `${base.slice(0, max - 1).trimEnd()}…` : base
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`
}
