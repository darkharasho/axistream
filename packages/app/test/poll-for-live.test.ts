import { describe, it, expect, vi } from 'vitest'
import { pollForLive } from '../src/main/pollForLive.js'

const noSleep = async () => {}

describe('pollForLive', () => {
  it('resolves true as soon as confirm() succeeds', async () => {
    const confirm = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const ok = await pollForLive({ confirm, pollMs: 1, maxAttempts: 15, sleep: noSleep })
    expect(ok).toBe(true)
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('resolves false after maxAttempts without success', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const ok = await pollForLive({ confirm, pollMs: 1, maxAttempts: 3, sleep: noSleep })
    expect(ok).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(3)
  })

  it('treats a confirm() rejection as false and keeps polling', async () => {
    const confirm = vi.fn()
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce(true)
    const ok = await pollForLive({ confirm, pollMs: 1, maxAttempts: 5, sleep: noSleep })
    expect(ok).toBe(true)
  })

  it('stops early when shouldStop() becomes true', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    let stop = false
    const p = pollForLive({
      confirm, pollMs: 1, maxAttempts: Infinity,
      sleep: async () => { stop = true }, shouldStop: () => stop,
    })
    await expect(p).resolves.toBe(false)
  })
})
