import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRecordingFinalizer } from '../src/main/record-finalize.js'

afterEach(() => { vi.useRealTimers() })

describe('createRecordingFinalizer', () => {
  it('stops the health poll before issuing the stop', async () => {
    const order: string[] = []
    const finalize = createRecordingFinalizer({
      stopHealthPoll: () => { order.push('poll') },
      stopRecording: async () => { order.push('stop') },
    })
    await finalize()
    expect(order).toEqual(['poll', 'stop'])
  })

  it('issues exactly one StopRecord when a second close joins the first', async () => {
    // OBS has one record output: a close arriving while the first is still
    // deferred must join the in-flight stop, not send another.
    let settle = () => {}
    const stopRecording = vi.fn(() => new Promise<void>((r) => { settle = r }))
    const finalize = createRecordingFinalizer({ stopHealthPoll: () => {}, stopRecording })
    const first = finalize()
    const second = finalize()
    expect(second).toBe(first)
    settle()
    await Promise.all([first, second])
    expect(stopRecording).toHaveBeenCalledTimes(1)
  })

  it('resolves on the box when OBS never answers, so quitting cannot hang', async () => {
    vi.useFakeTimers()
    const finalize = createRecordingFinalizer({
      stopHealthPoll: () => {},
      stopRecording: () => new Promise<void>(() => {}),
      timeoutMs: 2000,
    })
    let done = false
    void finalize().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(1999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })

  it('resolves rather than rejecting when the stop fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const finalize = createRecordingFinalizer({
      stopHealthPoll: () => {},
      stopRecording: async () => { throw new Error('websocket gone') },
    })
    await expect(finalize()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
