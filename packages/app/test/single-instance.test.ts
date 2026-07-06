import { describe, it, expect, vi } from 'vitest'
import { enforceSingleInstance } from '../src/main/single-instance.js'

function deps(lock: boolean | (() => boolean)) {
  const quit = vi.fn()
  const listeners: Record<string, () => void> = {}
  return {
    quit,
    listeners,
    d: {
      requestSingleInstanceLock: typeof lock === 'function' ? lock : () => lock,
      quit,
      on: (e: 'second-instance', cb: () => void) => { listeners[e] = cb },
    },
  }
}

describe('enforceSingleInstance', () => {
  it('primary: returns true, arms second-instance, never quits', () => {
    const t = deps(true)
    const onSecond = vi.fn()
    expect(enforceSingleInstance(t.d, onSecond)).toBe(true)
    expect(t.quit).not.toHaveBeenCalled()
    t.listeners['second-instance']()
    expect(onSecond).toHaveBeenCalledTimes(1)
  })

  it('secondary: quits and returns false', () => {
    const t = deps(false)
    expect(enforceSingleInstance(t.d, vi.fn())).toBe(false)
    expect(t.quit).toHaveBeenCalledTimes(1)
    expect(t.listeners['second-instance']).toBeUndefined()
  })

  it('throwing lock request is treated as primary', () => {
    const t = deps(() => { throw new Error('ipc down') })
    expect(enforceSingleInstance(t.d, vi.fn())).toBe(true)
    expect(t.quit).not.toHaveBeenCalled()
  })
})
