import { describe, it, expect, vi } from 'vitest'
import { createSidecarTeardown } from '../src/main/quit-teardown.js'

describe('createSidecarTeardown', () => {
  it('resolves only once the sidecar has actually stopped', async () => {
    let release: () => void = () => {}
    const stopSidecar = vi.fn(() => new Promise<void>((r) => { release = r }))
    const teardown = createSidecarTeardown({ stopSidecar })
    let settled = false
    void teardown().then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await teardown()
    expect(settled).toBe(true)
  })

  it('memoizes: a second close joins the first stop instead of sending another', async () => {
    const stopSidecar = vi.fn(() => Promise.resolve())
    const teardown = createSidecarTeardown({ stopSidecar })
    await Promise.all([teardown(), teardown()])
    expect(stopSidecar).toHaveBeenCalledOnce()
  })

  it('gives up on a hung sidecar so quitting cannot wedge', async () => {
    vi.useFakeTimers()
    try {
      const teardown = createSidecarTeardown({ stopSidecar: () => new Promise<void>(() => {}), timeoutMs: 3000 })
      let settled = false
      void teardown().then(() => { settled = true })
      await vi.advanceTimersByTimeAsync(3000)
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves rather than rejecting when the stop fails', async () => {
    const teardown = createSidecarTeardown({ stopSidecar: () => Promise.reject(new Error('obs gone')) })
    await expect(teardown()).resolves.toBeUndefined()
  })
})
