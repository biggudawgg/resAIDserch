import { Bot } from 'lucide-react'
import { cx } from '../../lib/cx'
import { initials } from '../../lib/format'

function hash(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h
}

export function Avatar({ name, size = 'md', agent = false }: { name: string; size?: 'xs' | 'sm' | 'md' | 'lg'; agent?: boolean }) {
  if (agent) {
    return (
      <span className={cx('avatar', `avatar-${size}`, 'avatar-agent')} title={name} aria-hidden>
        <Bot />
      </span>
    )
  }
  return (
    <span className={cx('avatar', `avatar-${size}`, `avatar-c${hash(name) % 6}`)} title={name} aria-hidden>
      {initials(name)}
    </span>
  )
}

export function AvatarStack({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max)
  const extra = names.length - shown.length
  return (
    <span className="avatar-stack" aria-label={names.join(', ')} role="img">
      {shown.map((name) => (
        <Avatar key={name} name={name} size="sm" />
      ))}
      {extra > 0 && <span className="avatar avatar-sm avatar-more">+{extra}</span>}
    </span>
  )
}
