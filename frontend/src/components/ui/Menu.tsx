import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '../../lib/cx'

export interface MenuItem {
  label: string
  icon?: ReactNode
  hint?: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

export interface MenuTriggerProps {
  onClick: () => void
  'aria-expanded': boolean
  'aria-haspopup': 'menu'
}

export function Menu({
  trigger,
  items,
  label,
  align = 'end',
}: {
  trigger: (props: MenuTriggerProps) => ReactNode
  items: Array<MenuItem | 'separator'>
  label: string
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const root = rootRef.current
    root?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
    const onPointer = (event: MouseEvent) => {
      if (!root?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return
    if (event.key === 'Escape') {
      event.stopPropagation()
      setOpen(false)
      rootRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const options = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])
    const index = options.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? (index + 1) % options.length : (index - 1 + options.length) % options.length
    options[next]?.focus()
  }

  return (
    <div className="menu-root" ref={rootRef} onKeyDown={onKeyDown}>
      {trigger({ onClick: () => setOpen((value) => !value), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <div className={cx('menu', `menu-${align}`)} role="menu" aria-label={label}>
          {items.map((item, index) =>
            item === 'separator' ? (
              <div key={`sep-${index}`} className="menu-sep" role="separator" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={cx('menu-item', item.danger && 'is-danger')}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                {item.icon}
                <span className="menu-item-label">{item.label}</span>
                {item.hint && <span className="menu-hint">{item.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
