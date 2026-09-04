import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** A dropdown that AxiStream can actually style.
 *
 *  Electron 31 ships Chromium 126, where a native <select>'s popup is drawn by
 *  the platform, not the page: it lands light-themed on Linux and reads as a
 *  different app pasted over the panel. CSS cannot reach it — `appearance:
 *  base-select` is Chromium 135+. So the popup is ours: a button trigger plus
 *  a listbox.
 *
 *  Native <select> stays the right answer for short, plain lists (resolution,
 *  frame rate). Reach for this one when rows need to explain themselves. */

export interface SelectOption {
  value: string
  label: string
  /** Short badge on the row's right edge — why a disabled row is disabled. */
  note?: string
  disabled?: boolean
}

interface Position {
  left: number
  width: number
  /** Set exactly one: the popup grows down from `top` or up from `bottom`. */
  top?: number
  bottom?: number
}

const GAP = 6
/** Enough for the encoder list; longer lists scroll inside the popup. */
const MAX_POPUP_HEIGHT = 340

/** The popup is portalled to <body> because `.settings-panel` scrolls, and an
 *  absolutely-positioned child would be clipped by it. Fixed coordinates then
 *  have to be recomputed — rather than track the trigger, close on scroll. */
function positionFor(trigger: HTMLElement): Position {
  const r = trigger.getBoundingClientRect()
  const below = window.innerHeight - r.bottom - GAP
  return below >= Math.min(MAX_POPUP_HEIGHT, 160) || below >= r.top
    ? { left: r.left, width: r.width, top: r.bottom + GAP }
    : { left: r.left, width: r.width, bottom: window.innerHeight - r.top + GAP }
}

const nextEnabled = (options: readonly SelectOption[], from: number, step: number): number => {
  for (let i = from; i >= 0 && i < options.length; i += step) {
    if (!options[i].disabled) return i
  }
  return -1
}

export function Select({ label, value, options, onChange }: {
  label: string
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [pos, setPos] = useState<Position | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = options.findIndex((o) => o.value === value)
  // A value with no matching option would leave the trigger blank; show the
  // raw value instead, which is at least honest about what is stored.
  const shown = selected >= 0 ? options[selected].label : value

  const openList = (startAt: number) => {
    const el = triggerRef.current
    if (!el) return
    setPos(positionFor(el))
    setActive(startAt)
    setOpen(true)
  }

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  const pick = (i: number) => {
    const opt = options[i]
    if (!opt || opt.disabled) return
    if (opt.value !== value) onChange(opt.value)
    close()
  }

  // Move focus into the popup on open so arrow keys and Escape reach it
  // wherever the pointer happens to be.
  useEffect(() => {
    if (open) listRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (listRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      // No refocus: clicking elsewhere is a request to go there, not back.
      close(false)
    }
    const onScrollOrResize = () => close(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    // Capture phase catches scrolling of any ancestor, not just the window.
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open])

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Tab') { close(); e.preventDefault(); return }
    if (e.key === 'Enter' || e.key === ' ') { pick(active); e.preventDefault(); return }
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (step) {
      const i = nextEnabled(options, active + step, step)
      if (i >= 0) setActive(i)
      e.preventDefault()
      return
    }
    if (e.key === 'Home' || e.key === 'End') {
      const i = e.key === 'Home' ? nextEnabled(options, 0, 1) : nextEnabled(options, options.length - 1, -1)
      if (i >= 0) setActive(i)
      e.preventDefault()
    }
  }

  return (
    <div className="field">
      <span id={`${id}-label`}>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="sel-trigger"
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-controls={`${id}-list`}
        aria-expanded={open}
        onClick={() => (open ? close() : openList(selected))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            openList(selected >= 0 ? selected : nextEnabled(options, 0, 1))
            e.preventDefault()
          }
        }}
      >
        {shown}
      </button>

      {open && pos ? createPortal(
        <div
          ref={listRef}
          id={`${id}-list`}
          className="sel-list"
          role="listbox"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          onKeyDown={onListKeyDown}
          style={{
            position: 'fixed',
            left: pos.left,
            width: pos.width,
            top: pos.top,
            bottom: pos.bottom,
            maxHeight: MAX_POPUP_HEIGHT,
          }}
        >
          {options.map((o, i) => (
            <div
              key={o.value}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              className={`opt${o.value === value ? ' on' : ''}${i === active && !o.disabled ? ' active' : ''}`}
              // Options are not focusable: focus stays on the listbox and
              // aria-activedescendant reports the active row, so a click never
              // has to steal it back.
              onClick={() => pick(i)}
              onMouseMove={() => { if (!o.disabled && i !== active) setActive(i) }}
            >
              <span className="opt-label">{o.label}</span>
              {o.note ? <span className="why">{o.note}</span> : null}
            </div>
          ))}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
