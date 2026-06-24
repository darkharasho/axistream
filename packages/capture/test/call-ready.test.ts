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
})
