/**
 * Profile menu, ported from KokonutUI's Account Menu ("profile-dropdown", Tailwind + motion) to this app's CSS.
 *
 * Original: "Account Menu" v2.0.0 by @dorianbaffier, https://kokonutui.com/docs/navigation/profile-dropdown
 * Copyright (c) Kokonut Labs. Licensed under the MIT License, https://github.com/kokonut-labs/kokonutui
 *
 * Changes from the original: the panel grows upward from a trigger at the bottom of the sidebar and keeps the
 * trigger's width; the second page lists the workspace team instead of switching accounts; the theme row drives the
 * app theme; hold-to-confirm resets this browser's preferences (the demo has no sign-in); styling uses CSS classes.
 */
import { type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronLeft, ChevronRight, ChevronsUpDown, Command, Cpu, Monitor, Moon, RotateCcw, Settings, Sun, Users } from 'lucide-react'
import { animate, motion, type Transition, useMotionTemplate, useMotionValue, useReducedMotion } from 'motion/react'
import type { Member, Role } from '../../api/types'
import { cx } from '../../lib/cx'
import { avatarSeed, saveAvatarVariant } from '../../lib/faces'
import { useMyAvatarVariant } from '../../lib/hooks'
import { useTheme, type ThemeMode } from '../../lib/theme'
import { useUI } from '../../lib/ui'
import { Avatar } from '../ui/Avatar'

export type PresenceStatus = 'online' | 'away' | 'busy'

const STATUSES: { id: PresenceStatus; label: string; name: string }[] = [
  { id: 'online', label: 'Online', name: 'Online' },
  { id: 'away', label: 'Away', name: 'Away' },
  { id: 'busy', label: 'Busy', name: 'Do not disturb' },
]

const THEMES = [
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
  { id: 'system', label: 'System', Icon: Monitor },
] as const

const ROLE_TEXT: Record<Role, string> = { lead: 'Lead', researcher: 'Researcher', engineer: 'Engineer', viewer: 'Viewer' }

const RADIUS = 12
const SPRING: Transition = { type: 'spring', duration: 0.3, bounce: 0 }
const INDICATOR_SPRING: Transition = { type: 'spring', duration: 0.25, bounce: 0 }
const INSTANT: Transition = { duration: 0 }
const EASE_OUT = [0.23, 1, 0.32, 1] as const
const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])
const STATUS_KEY = 'resaidserch.presence'
/** Everything this browser remembers for the demo; cleared by "Reset my preferences". */
const PREFERENCE_KEYS = ['hs-theme', STATUS_KEY, 'resaidserch.palette-recent', 'resaidserch.onboarding']

type Phase = 'closed' | 'open' | 'closing'
type Page = 'main' | 'team'
type Via = 'pointer' | 'keyboard'

function readStatus(): PresenceStatus {
  try {
    const v = localStorage.getItem(STATUS_KEY)
    return v === 'away' || v === 'busy' ? v : 'online'
  } catch {
    return 'online'
  }
}

function viaOf(event: MouseEvent): Via {
  // A click fired by Enter or Space carries no pointer detail.
  return event.detail === 0 ? 'keyboard' : 'pointer'
}

function menuItems(root: HTMLElement | null) {
  return root ? Array.from(root.querySelectorAll<HTMLElement>('[data-menu-item]')) : []
}

function sideTarget(items: HTMLElement[], current: HTMLElement, step: number) {
  const row = items.filter((item) => item.dataset.row === current.dataset.row)
  if (row.length < 2) return undefined
  const index = row.indexOf(current)
  return row[(index + step + row.length) % row.length]
}

function rowTarget(items: HTMLElement[], current: HTMLElement, step: number) {
  const rows = [...new Set(items.map((item) => item.dataset.row))]
  const index = rows.indexOf(current.dataset.row)
  const next = rows[(index + step + rows.length) % rows.length]
  const candidates = items.filter((item) => item.dataset.row === next)
  return candidates.find((item) => item.getAttribute('aria-checked') === 'true') ?? candidates[0]
}

/** Where arrow keys move focus: rows go up and down, radios left and right. */
function nextTarget(items: HTMLElement[], active: Element | null, key: string): HTMLElement | undefined {
  if (key === 'Home') return items[0]
  if (key === 'End') return items[items.length - 1]
  const current = items.find((item) => item === active)
  if (!current) return key === 'ArrowUp' ? items[items.length - 1] : items[0]
  if (key === 'ArrowLeft' || key === 'ArrowRight') return sideTarget(items, current, key === 'ArrowRight' ? 1 : -1)
  return rowTarget(items, current, key === 'ArrowDown' ? 1 : -1)
}

function PresenceAvatar({ member, status, size, faceSeed }: { member: Member; status?: PresenceStatus; size: 'sm' | 'md'; faceSeed?: string }) {
  return (
    <span className="pmenu-avatar">
      <Avatar faceSeed={faceSeed} name={member.name} size={size} />
      {status && <span className={cx('pmenu-presence', `is-${status}`)} />}
    </span>
  )
}

/**
 * The avatar, name and role. Rendered in the trigger while the menu is closed and in the menu header while it is
 * open; shared layout ids let the pieces travel between the two places.
 */
function Identity({
  uid,
  shared,
  member,
  status,
  transition,
  stacked,
  faceSeed,
}: {
  uid: string
  shared: boolean
  member: Member
  status: PresenceStatus
  transition: Transition
  stacked: boolean
  faceSeed?: string
}) {
  const hidden = shared ? undefined : 'is-hidden'
  return (
    <span className={cx('pmenu-identity', stacked && 'is-stacked')}>
      <motion.span className={cx('pmenu-shared', hidden)} key={shared ? 'a-s' : 'a-x'} layoutId={shared ? `${uid}-avatar` : undefined} transition={transition}>
        <PresenceAvatar faceSeed={faceSeed} member={member} size={stacked ? 'md' : 'sm'} status={status} />
      </motion.span>
      <span className="pmenu-identity-text">
        <motion.span className={cx('pmenu-shared pmenu-name', hidden)} key={shared ? 'n-s' : 'n-x'} layoutId={shared ? `${uid}-name` : undefined} transition={transition}>
          {member.name}
        </motion.span>
        <motion.span className={cx('pmenu-shared pmenu-sub', hidden)} key={shared ? 'e-s' : 'e-x'} layoutId={shared ? `${uid}-email` : undefined} transition={transition}>
          {stacked ? member.email : ROLE_TEXT[member.role]}
        </motion.span>
      </span>
    </span>
  )
}

function Separator() {
  return <hr className="pmenu-sep" />
}

function HoldAction({ duration, label, icon, onComplete }: { duration: number; label: string; icon: ReactNode; onComplete: (via: Via) => void }) {
  const [holding, setHolding] = useState(false)
  const [done, setDone] = useState(false)
  const [nudge, setNudge] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const nudgeTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      window.clearTimeout(timer.current)
      window.clearTimeout(nudgeTimer.current)
    }
  }, [])

  const start = (via: Via) => {
    if (timer.current !== undefined || done) return
    window.clearTimeout(nudgeTimer.current)
    setNudge(false)
    setHolding(true)
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      setHolding(false)
      setDone(true)
      onComplete(via)
    }, duration)
  }

  const cancel = () => {
    if (timer.current === undefined) return
    window.clearTimeout(timer.current)
    timer.current = undefined
    setHolding(false)
    setNudge(true)
    nudgeTimer.current = window.setTimeout(() => setNudge(false), 1400)
  }

  const inner = (
    <>
      {icon}
      <span className="pmenu-item-label">{label}</span>
      <span className="pmenu-item-value">{nudge ? 'Keep holding' : 'Hold'}</span>
    </>
  )

  return (
    <button
      className="pmenu-item pmenu-hold"
      data-menu-item=""
      data-row="hold"
      onBlur={cancel}
      onClick={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (!event.repeat) start('keyboard')
        }
      }}
      onKeyUp={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          cancel()
        }
      }}
      onPointerCancel={cancel}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        start('pointer')
      }}
      onPointerUp={cancel}
      role="menuitem"
      tabIndex={-1}
      type="button"
    >
      {inner}
      <span className="sr-only">, press and hold to confirm</span>
      {/* The fill: an inverted copy of the row, revealed left to right. */}
      <span
        aria-hidden
        className="pmenu-hold-fill"
        style={{
          clipPath: holding || done ? `inset(0 0 0 0 round 8px)` : `inset(0 100% 0 0 round 8px)`,
          transition: holding ? `clip-path ${duration}ms linear` : 'clip-path 240ms cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      >
        {inner}
      </span>
    </button>
  )
}

export function ProfileMenu({ me, members, holdDuration = 1200 }: { me: Member; members: Member[]; holdDuration?: number }) {
  const uid = useId()
  const navigate = useNavigate()
  const { openPalette, toast } = useUI()
  const { mode, setMode } = useTheme()
  const reduced = useReducedMotion() === true
  const [phase, setPhase] = useState<Phase>('closed')
  const [instant, setInstant] = useState(false)
  const [page, setPage] = useState<Page>('main')
  const [openSeq, setOpenSeq] = useState(0)
  const [status, setStatusState] = useState<PresenceStatus>(readStatus)
  const [panelW, setPanelW] = useState(0)
  const myVariant = useMyAvatarVariant()
  const myFace = myVariant === null ? undefined : avatarSeed(me.name, myVariant)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const teamRef = useRef<HTMLDivElement>(null)
  const phaseRef = useRef<Phase>('closed')
  phaseRef.current = phase
  const openIntent = useRef<{ focus: 'first' | 'last' | 'menu'; resume: boolean }>({ focus: 'menu', resume: false })
  const pageFocus = useRef<'first' | 'switch' | null>(null)
  const closeSeq = useRef(0)
  const targetH = useRef(0)

  // The panel's visible box, anchored bottom-left. Border, fill and content all clip to it, so the menu grows out of
  // the trigger's own rectangle without layout work per frame.
  const w = useMotionValue(0)
  const h = useMotionValue(0)
  const pageX = useMotionValue(0)
  const bodyOpacity = useMotionValue(1)
  const outerClip = useMotionTemplate`inset(calc(100% - ${h}px) calc(100% - ${w}px) 0px 0px round ${RADIUS}px)`
  const innerClip = useMotionTemplate`inset(calc(100% - ${h}px + 1px) calc(100% - ${w}px + 1px) 1px 1px round ${RADIUS - 1}px)`
  const pageTransform = useMotionTemplate`translate3d(${pageX}px, 0, 0)`

  const sharedTransition = instant ? INSTANT : SPRING
  const sharedInPanel = phase === 'open'
  const menuId = `${uid}-menu`
  const others = members.filter((m) => m.id !== me.id)

  const setStatus = (next: PresenceStatus) => {
    setStatusState(next)
    try {
      localStorage.setItem(STATUS_KEY, next)
    } catch {
      /* storage unavailable: status lasts for this session only */
    }
  }

  const pageEl = (target: Page) => (target === 'main' ? mainRef.current : teamRef.current)

  const openMenu = (via: Via, focus: 'first' | 'last' | 'menu') => {
    if (phaseRef.current === 'open') return
    setPanelW(triggerRef.current?.offsetWidth ?? 228)
    openIntent.current = { focus, resume: phaseRef.current === 'closing' }
    closeSeq.current += 1
    setInstant(via === 'keyboard' || reduced)
    setPage('main')
    setPhase('open')
    setOpenSeq((seq) => seq + 1)
  }

  const closeMenu = (via: Via, returnFocus: boolean) => {
    if (phaseRef.current !== 'open') return
    const trigger = triggerRef.current
    if (returnFocus) trigger?.focus({ preventScroll: true })
    if (via === 'keyboard' || reduced || !trigger) {
      setInstant(true)
      setPhase('closed')
      return
    }
    setInstant(false)
    setPhase('closing')
    const seq = ++closeSeq.current
    animate(bodyOpacity, 0, { duration: 0.12, ease: EASE_OUT })
    animate(w, trigger.offsetWidth, SPRING)
    animate(h, trigger.offsetHeight, SPRING).then(() => {
      if (closeSeq.current === seq) setPhase('closed')
    })
  }

  const goTo = (target: Page) => {
    pageFocus.current = target === 'team' ? 'first' : 'switch'
    setPage(target)
  }

  const select = (event: MouseEvent, run?: () => void) => {
    run?.()
    closeMenu(viaOf(event), true)
  }

  // Opening: size the clip to the trigger, then spring it out to the menu. A keyboard open skips to the end.
  useLayoutEffect(() => {
    const trigger = triggerRef.current
    const main = mainRef.current
    if (openSeq === 0 || phaseRef.current !== 'open' || !trigger || !main) return
    pageX.jump(0)
    targetH.current = main.offsetHeight
    const width = trigger.offsetWidth
    if (instant) {
      w.jump(width)
      h.jump(targetH.current)
      bodyOpacity.jump(1)
    } else {
      if (!openIntent.current.resume) {
        w.jump(width)
        h.jump(trigger.offsetHeight)
        bodyOpacity.jump(0)
      }
      animate(w, width, SPRING)
      animate(h, targetH.current, SPRING)
      animate(bodyOpacity, 1, { duration: 0.2, delay: 0.05, ease: EASE_OUT })
    }
    const list = menuItems(main)
    const targets = { first: list[0], last: list[list.length - 1], menu: main.querySelector<HTMLElement>('[role=menu]') }
    targets[openIntent.current.focus]?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per open
  }, [openSeq])

  // Switching pages: push sideways and spring the height to the new page.
  useEffect(() => {
    const el = pageEl(page)
    if (phaseRef.current !== 'open' || !el) return
    const x = page === 'main' ? 0 : -panelW
    targetH.current = el.offsetHeight
    if (reduced) {
      pageX.jump(x)
      h.jump(targetH.current)
    } else {
      animate(pageX, x, SPRING)
      animate(h, targetH.current, SPRING)
    }
    const intent = pageFocus.current
    pageFocus.current = null
    if (intent === 'first') {
      const list = menuItems(el)
      const checked = list.find((item) => item.getAttribute('aria-checked') === 'true')
      ;(checked ?? list[0])?.focus({ preventScroll: true })
    } else if (intent === 'switch') {
      el.querySelector<HTMLElement>('[data-switch]')?.focus({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on page
  }, [page])

  // Keep the height in step if a page's content changes size while open.
  useEffect(() => {
    if (phase !== 'open') return
    const observer = new ResizeObserver(() => {
      const el = pageEl(page)
      if (!el || phaseRef.current !== 'open') return
      const next = el.offsetHeight
      if (Math.abs(next - targetH.current) < 0.5) return
      targetH.current = next
      animate(h, next, reduced ? INSTANT : SPRING)
    })
    for (const el of [mainRef.current, teamRef.current]) if (el) observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- observers read refs
  }, [phase, page])

  // A press anywhere outside closes, with the morph.
  useEffect(() => {
    if (phase !== 'open') return
    const onDown = (event: globalThis.PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) closeMenu('pointer', false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeMenu reads refs
  }, [phase])

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      closeMenu('keyboard', true)
      return
    }
    if (page === 'team' && event.key === 'Backspace') {
      event.preventDefault()
      goTo('main')
      return
    }
    if (!NAV_KEYS.has(event.key)) return
    event.preventDefault()
    const active = document.activeElement
    const target = nextTarget(menuItems(pageEl(page)), active, event.key)
    if (target) target.focus({ preventScroll: true })
    else if (page === 'team' && event.key === 'ArrowLeft') goTo('main')
    else if (event.key === 'ArrowRight' && active instanceof HTMLElement && active.dataset.switch !== undefined) goTo('team')
  }

  // Hovering an item focuses it, so pointer and keyboard share one highlight.
  const onPanelPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-menu-item]')
    if (item && document.activeElement !== item) item.focus({ preventScroll: true })
  }

  const links: { label: string; icon: ReactNode; value?: string; run: () => void }[] = [
    { label: 'Settings', icon: <Settings />, run: () => navigate('/settings/general') },
    { label: 'Providers & usage', icon: <Cpu />, value: 'G P', run: () => navigate('/providers') },
    { label: 'Commands', icon: <Command />, value: 'Ctrl K', run: () => window.setTimeout(openPalette, 260) },
  ]

  return (
    <div className={cx('pmenu', phase !== 'closed' && 'is-active')} ref={wrapperRef}>
      <button
        aria-controls={sharedInPanel ? menuId : undefined}
        aria-expanded={sharedInPanel}
        aria-haspopup="menu"
        className="pmenu-trigger"
        onClick={(event) => {
          const via = viaOf(event)
          openMenu(via, via === 'keyboard' ? 'first' : 'menu')
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            openMenu('keyboard', event.key === 'ArrowDown' ? 'first' : 'last')
          }
        }}
        ref={triggerRef}
        type="button"
      >
        <span className="pmenu-trigger-main">
          <Identity faceSeed={myFace} member={me} shared={!sharedInPanel} stacked={false} status={status} transition={sharedTransition} uid={uid} />
        </span>
        <ChevronsUpDown aria-hidden className={cx('pmenu-chevrons', phase !== 'closed' && 'is-hidden')} />
      </button>

      {phase === 'closed' ? null : (
        <div className="pmenu-panel" style={{ width: panelW }}>
          <div aria-hidden className="pmenu-surface">
            <motion.div className="pmenu-surface-border" style={{ clipPath: outerClip }} />
            <motion.div className="pmenu-surface-fill" style={{ clipPath: innerClip }} />
          </div>
          <motion.div
            className={cx('pmenu-clip', sharedInPanel && 'is-live')}
            onKeyDown={onPanelKeyDown}
            onPointerMove={onPanelPointerMove}
            style={{ clipPath: innerClip }}
          >
            <motion.div className="pmenu-pages" style={{ transform: pageTransform }}>
              <div
                className={cx('pmenu-page', page !== 'main' && 'is-away')}
                {...(page !== 'main' ? ({ inert: '' } as Record<string, string>) : {})}
                ref={mainRef}
                style={{ width: panelW }}
              >
                <div className="pmenu-head">
                  <Identity faceSeed={myFace} member={me} shared={sharedInPanel} stacked status={status} transition={sharedTransition} uid={uid} />
                  <motion.span className="pmenu-role" style={{ opacity: bodyOpacity }}>
                    {ROLE_TEXT[me.role]}
                  </motion.span>
                </div>
                <motion.div aria-label={me.name} className="pmenu-menu" id={menuId} role="menu" style={{ opacity: bodyOpacity }} tabIndex={-1}>
                  <fieldset aria-label="Status" className="pmenu-row">
                    <span className="pmenu-row-label">Status</span>
                    <span className="pmenu-radios">
                      {STATUSES.map((entry) => {
                        const checked = entry.id === status
                        return (
                          <button
                            aria-checked={checked}
                            aria-label={entry.name}
                            className="pmenu-status"
                            data-menu-item=""
                            data-row="status"
                            key={entry.id}
                            onClick={() => setStatus(entry.id)}
                            role="menuitemradio"
                            tabIndex={-1}
                            type="button"
                          >
                            <span className={cx('pmenu-status-dot', checked && `is-${entry.id}`)} />
                            {entry.label}
                          </button>
                        )
                      })}
                    </span>
                  </fieldset>
                  <fieldset aria-label="Theme" className="pmenu-row">
                    <span className="pmenu-row-label">Theme</span>
                    <span className="pmenu-themes">
                      {THEMES.map(({ id, label, Icon }) => {
                        const checked = id === mode
                        return (
                          <button
                            aria-checked={checked}
                            aria-label={label}
                            className="pmenu-theme"
                            data-menu-item=""
                            data-row="theme"
                            key={id}
                            onClick={() => setMode(id as ThemeMode)}
                            role="menuitemradio"
                            tabIndex={-1}
                            type="button"
                          >
                            {checked ? (
                              <motion.span className="pmenu-theme-pill" layoutId={`${uid}-theme`} transition={reduced ? INSTANT : INDICATOR_SPRING} />
                            ) : null}
                            <Icon className="pmenu-theme-icon" />
                          </button>
                        )
                      })}
                    </span>
                  </fieldset>
                  <Separator />
                  {links.map((item, index) => (
                    <button
                      className="pmenu-item"
                      data-menu-item=""
                      data-row={`item-${index}`}
                      key={item.label}
                      onClick={(event) => select(event, item.run)}
                      role="menuitem"
                      tabIndex={-1}
                      type="button"
                    >
                      <span className="pmenu-item-icon">{item.icon}</span>
                      <span className="pmenu-item-label">{item.label}</span>
                      {item.value && <span className="pmenu-item-value">{item.value}</span>}
                    </button>
                  ))}
                  {others.length > 0 && (
                    <button
                      aria-expanded={page === 'team'}
                      aria-haspopup="menu"
                      className="pmenu-item"
                      data-menu-item=""
                      data-row="switch"
                      data-switch=""
                      onClick={() => goTo('team')}
                      role="menuitem"
                      tabIndex={-1}
                      type="button"
                    >
                      <span className="pmenu-stack">
                        {others.slice(0, 3).map((m) => (
                          <Avatar key={m.id} name={m.name} size="xs" />
                        ))}
                      </span>
                      <span className="pmenu-item-label">Your team</span>
                      <span className="pmenu-item-value">{members.length}</span>
                      <ChevronRight className="pmenu-item-chevron" />
                    </button>
                  )}
                  <Separator />
                  <HoldAction
                    duration={holdDuration}
                    icon={<RotateCcw />}
                    label="Reset my preferences"
                    onComplete={(via) => {
                      for (const key of PREFERENCE_KEYS) {
                        try {
                          localStorage.removeItem(key)
                        } catch {
                          /* storage unavailable: nothing to clear */
                        }
                      }
                      try {
                        sessionStorage.clear()
                      } catch {
                        /* ignore */
                      }
                      setMode('system')
                      saveAvatarVariant(null)
                      setStatusState('online')
                      toast('Preferences reset', { tone: 'info', description: 'Theme, status, avatar, recent commands and the welcome screen are back to their defaults.' })
                      closeMenu(via, true)
                    }}
                  />
                </motion.div>
              </div>

              <div
                className={cx('pmenu-page', page !== 'team' && 'is-away')}
                {...(page !== 'team' ? ({ inert: '' } as Record<string, string>) : {})}
                ref={teamRef}
                style={{ width: panelW }}
              >
                <motion.div aria-label="Your team" className="pmenu-menu" role="menu" style={{ opacity: bodyOpacity }} tabIndex={-1}>
                  <button className="pmenu-item pmenu-back" data-menu-item="" data-row="back" onClick={() => goTo('main')} role="menuitem" tabIndex={-1} type="button">
                    <ChevronLeft className="pmenu-item-chevron" />
                    <span className="sr-only">Back to </span>
                    Your team
                  </button>
                  <Separator />
                  {members.map((m) => {
                    const isMe = m.id === me.id
                    return (
                      <button
                        aria-checked={isMe}
                        className="pmenu-item"
                        data-menu-item=""
                        data-row={`member-${m.id}`}
                        key={m.id}
                        onClick={(event) => select(event, () => navigate('/settings/members'))}
                        role="menuitemradio"
                        tabIndex={-1}
                        type="button"
                      >
                        <PresenceAvatar faceSeed={isMe ? myFace : undefined} member={m} size="sm" status={isMe ? status : undefined} />
                        <span className="pmenu-member">
                          <span className="pmenu-member-name">
                            {m.name}
                            {isMe && <span className="pmenu-you"> (you)</span>}
                          </span>
                          <span className="pmenu-member-role">{ROLE_TEXT[m.role]}</span>
                        </span>
                        {isMe ? <Check className="pmenu-item-check" /> : null}
                      </button>
                    )
                  })}
                  <Separator />
                  <button
                    className="pmenu-item"
                    data-menu-item=""
                    data-row="manage"
                    onClick={(event) => select(event, () => navigate('/settings/members'))}
                    role="menuitem"
                    tabIndex={-1}
                    type="button"
                  >
                    <span className="pmenu-item-icon">
                      <Users />
                    </span>
                    <span className="pmenu-item-label">Manage members</span>
                  </button>
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
