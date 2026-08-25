import type { Toast, ToastPayload } from '../shared/state.js'

/** Info and success clear themselves; errors do not (see push). */
export const TOAST_TTL_MS = 4000
/** Beyond this the oldest is evicted, so a burst can't bury the UI. */
export const MAX_TOASTS = 3

export function createToastStore() {
  let toasts: Toast[] = []
  let seq = 0
  const subs = new Set<() => void>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const notify = () => subs.forEach((f) => f())

  const clearTimer = (id: string) => {
    const t = timers.get(id)
    if (t) { clearTimeout(t); timers.delete(id) }
  }

  const dismiss = (id: string) => {
    clearTimer(id)
    const next = toasts.filter((t) => t.id !== id)
    if (next.length === toasts.length) return
    toasts = next
    notify()
  }

  return {
    subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn) } },
    // Identity only changes on mutation — useSyncExternalStore requires this.
    getToasts: () => toasts,
    dismiss,
    push(payload: ToastPayload): string {
      const id = `t${++seq}`
      toasts = [...toasts, { ...payload, id }]
      while (toasts.length > MAX_TOASTS) {
        clearTimer(toasts[0].id)
        toasts = toasts.slice(1)
      }
      // Errors are sticky: one that vanishes before it's read is no error at all.
      if (payload.kind !== 'error') timers.set(id, setTimeout(() => dismiss(id), TOAST_TTL_MS))
      notify()
      return id
    },
  }
}

export type ToastStore = ReturnType<typeof createToastStore>
export const toastStore = createToastStore()
