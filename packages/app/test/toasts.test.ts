import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createToastStore, TOAST_TTL_MS, MAX_TOASTS } from '../src/renderer/toasts.js'

describe('toast store', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('push returns an id and exposes the toast', () => {
    const s = createToastStore()
    const id = s.push({ kind: 'info', message: 'hello' })
    expect(s.getToasts()).toEqual([{ id, kind: 'info', message: 'hello' }])
  })

  it('notifies subscribers on push and on dismiss', () => {
    const s = createToastStore()
    const fn = vi.fn()
    s.subscribe(fn)
    const id = s.push({ kind: 'info', message: 'hello' })
    expect(fn).toHaveBeenCalledTimes(1)
    s.dismiss(id)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not notify when dismissing an unknown id', () => {
    const s = createToastStore()
    const fn = vi.fn()
    s.subscribe(fn)
    s.dismiss('nope')
    expect(fn).not.toHaveBeenCalled()
  })

  it('auto-dismisses info after the TTL', () => {
    const s = createToastStore()
    s.push({ kind: 'info', message: 'hello' })
    vi.advanceTimersByTime(TOAST_TTL_MS - 1)
    expect(s.getToasts()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(s.getToasts()).toHaveLength(0)
  })

  it('auto-dismisses success after the TTL', () => {
    const s = createToastStore()
    s.push({ kind: 'success', message: 'done' })
    vi.advanceTimersByTime(TOAST_TTL_MS)
    expect(s.getToasts()).toHaveLength(0)
  })

  it('never auto-dismisses errors', () => {
    const s = createToastStore()
    s.push({ kind: 'error', message: 'boom', detail: 'HTTP 500' })
    vi.advanceTimersByTime(TOAST_TTL_MS * 10)
    expect(s.getToasts()).toHaveLength(1)
  })

  it('dismisses an error explicitly', () => {
    const s = createToastStore()
    const id = s.push({ kind: 'error', message: 'boom' })
    s.dismiss(id)
    expect(s.getToasts()).toHaveLength(0)
  })

  it('evicts the oldest beyond the cap', () => {
    const s = createToastStore()
    for (let i = 0; i < MAX_TOASTS + 2; i++) s.push({ kind: 'error', message: `m${i}` })
    expect(s.getToasts()).toHaveLength(MAX_TOASTS)
    expect(s.getToasts()[0].message).toBe('m2')
  })

  it('returns a stable array reference between mutations', () => {
    const s = createToastStore()
    s.push({ kind: 'error', message: 'a' })
    expect(s.getToasts()).toBe(s.getToasts())
  })

  it('unsubscribe stops notifications', () => {
    const s = createToastStore()
    const fn = vi.fn()
    const off = s.subscribe(fn)
    off()
    s.push({ kind: 'info', message: 'hello' })
    expect(fn).not.toHaveBeenCalled()
  })
})
