import { cx } from '../../lib/cx'
import { pct } from '../../lib/format'

type MeterTone = 'accent' | 'warn' | 'crit'

export function confidenceLevel(value: number): { tone: MeterTone; label: string } {
  if (value >= 0.7) return { tone: 'accent', label: 'Strong' }
  if (value >= 0.45) return { tone: 'warn', label: 'Moderate' }
  return { tone: 'crit', label: 'Weak' }
}

export function MeterBar({
  value,
  tone,
  label,
  valueText,
  size = 'md',
}: {
  value: number
  tone: MeterTone
  label: string
  valueText?: string
  size?: 'sm' | 'md'
}) {
  const clamped = Math.max(0, Math.min(1, value))
  return (
    <div
      className={cx('meter-track', `meter-${tone}`, size === 'sm' && 'meter-sm')}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuetext={valueText}
    >
      <div className="meter-fill" style={{ width: `${clamped * 100}%` }} />
    </div>
  )
}

/** Confidence as a same-ramp meter; the level word means colour never carries the reading alone. */
export function ConfidenceMeter({
  value,
  variant = 'full',
  label = 'Confidence',
}: {
  value: number
  variant?: 'full' | 'inline'
  label?: string
}) {
  const level = confidenceLevel(value)
  const text = `${pct(value)} · ${level.label}`
  if (variant === 'inline') {
    return (
      <div className="meter-inline">
        <MeterBar value={value} tone={level.tone} label={label} valueText={text} size="sm" />
        <span className="meter-inline-value">{pct(value)}</span>
      </div>
    )
  }
  return (
    <div className="meter">
      <div className="meter-head">
        <span className="meter-label">{label}</span>
        <span className="meter-reading">
          <strong>{pct(value)}</strong> {level.label}
        </span>
      </div>
      <MeterBar value={value} tone={level.tone} label={label} valueText={text} />
    </div>
  )
}
