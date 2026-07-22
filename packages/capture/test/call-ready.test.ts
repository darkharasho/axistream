import { describe, it, expect, vi } from 'vitest'
import { callReady } from '../src/call-ready.js'

describe('callReady', () => {
  it('returns immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    expect(await callReady(fn, { tries: 3, delayMs: 1 })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries until success', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('not ready'))
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValue('ok')
    expect(await callReady(fn, { tries: 5, delayMs: 1 })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('rethrows the last error after exhausting tries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('still not ready'))
    await expect(callReady(fn, { tries: 3, delayMs: 1 })).rejects.toThrow('still not ready')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry deterministic obs-websocket resource errors', async () => {
    // 600 ResourceNotFound / 601 ResourceAlreadyExists can never succeed on
    // retry; hammering them wastes the whole retry budget (the RemoveScene
    // fresh-collection flake). Fail fast after one attempt.
    for (const code of [600, 601]) {
      const err = Object.assign(new Error('resource error'), { code })
      const fn = vi.fn().mockRejectedValue(err)
      await expect(callReady(fn, { tries: 5, delayMs: 1 })).rejects.toBe(err)
      expect(fn).toHaveBeenCalledTimes(1)
    }
  })

  it('still retries transient errors that carry a numeric code (e.g. NotReady)', async () => {
    const err = Object.assign(new Error('OBS is not ready'), { code: 502 })
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue('ok')
    expect(await callReady(fn, { tries: 5, delayMs: 1 })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
