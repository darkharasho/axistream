import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Escape-to-close, focus trapping, and focus restoration for a modal region.
 *
 * onClose is held in a ref rather than declared as a dependency: callers pass
 * inline arrow functions, so a dependency would re-run the effect on every
 * render and restore focus to the trigger mid-interaction.
 */
export function useModalKeys(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  const cb = useRef(onClose)
  cb.current = onClose

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); cb.current(); return }
      if (e.key !== 'Tab') return
      const nodes = ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!nodes || nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      const inside = ref.current?.contains(active as Node) ?? false
      if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [ref])
}
