import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSmokeWatcher } from '../src/main/smoke.js'
import type { SmokeResult } from '../src/main/smoke.js'

describe('createSmokeWatcher', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('ready phase → code 0, called exactly once', () => {
    const onDone = vi.fn<(r: SmokeResult) => void>()
    const w = createSmokeWatcher(onDone)
    w.observe('READY', null)
    expect(onDone).toHaveBeenCalledTimes(1)
    const r = onDone.mock.calls[0][0]
    expect(r).toEqual({ code: 0, summary: 'SMOKE OK phase=READY' })
    // second observation must not fire again
    w.observe('READY', null)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('NEEDS_KEY phase → code 0 (expected on fresh runner)', () => {
    const onDone = vi.fn<(r: SmokeResult) => void>()
    const w = createSmokeWatcher(onDone)
    w.observe('NEEDS_KEY', null)
    expect(onDone).toHaveBeenCalledTimes(1)
    const r = onDone.mock.calls[0][0]
    expect(r).toEqual({ code: 0, summary: 'SMOKE OK phase=NEEDS_KEY' })
  })

  it('NEEDS_TITLE phase → code 0', () => {
    const onDone = vi.fn<(r: SmokeResult) => void>()
    const w = createSmokeWatcher(onDone)
    w.observe('NEEDS_TITLE', null)
    expect(onDone).toHaveBeenCalledTimes(1)
    const r = onDone.mock.calls[0][0]
    expect(r).toEqual({ code: 0, summary: 'SMOKE OK phase=NEEDS_TITLE' })
  })

  it('ERROR phase → code 1 with error in summary', () => {
    const onDone = vi.fn<(r: SmokeResult) => void>()
    const w = createSmokeWatcher(onDone)
    w.observe('ERROR', 'OBS crashed')
    expect(onDone).toHaveBeenCalledTimes(1)
    const r = onDone.mock.calls[0][0]
    expect(r.code).toBe(1)
    expect(r.summary).toContain('ERROR')
    expect(r.summary).toContain('OBS crashed')
  })

  it('timeout fires with code 1 and last observed phase', () => {
    const onDone = vi.fn<(r: SmokeResult) => void>()
    const w = createSmokeWatcher(onDone, 180000)
    w.observe('SETTING_UP', null)
    w.observe('AWAITING_APPROVAL', null)
    expect(onDone).not.toHaveBeenCalled()
    vi.advanceTimersByTime(180001)
    expect(onDone).toHaveBeenCalledTimes(1)
    const r = onDone.mock.calls[0][0]
    expect(r.code).toBe(1)
    expect(r.summary).toContain('timeout')
    expect(r.summary).toContain('180000')
    expect(r.summary).toContain('AWAITING_APPROVAL')
  })

  it('observations after settle are ignored', () => {
    const onDone = vi.fn<(r: SmokeResult) => void>()
    const w = createSmokeWatcher(onDone)
    w.observe('READY', null)
    expect(onDone).toHaveBeenCalledTimes(1)
    w.observe('ERROR', 'late error')
    w.observe('READY', null)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('dispose prevents timeout callback from firing', () => {
    const onDone = vi.fn<(r: SmokeResult) => void>()
    const w = createSmokeWatcher(onDone, 180000)
    w.observe('SETTING_UP', null)
    w.dispose()
    vi.advanceTimersByTime(200000)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('timeout with no prior observations shows empty lastPhase', () => {
    const onDone = vi.fn<(r: SmokeResult) => void>()
    createSmokeWatcher(onDone, 5000)
    vi.advanceTimersByTime(5001)
    expect(onDone).toHaveBeenCalledTimes(1)
    const r = onDone.mock.calls[0][0]
    expect(r.code).toBe(1)
    expect(r.summary).toContain('5000')
  })
})

describe('succeed()', () => {
  it('settles code 0 once and blocks later observations', () => {
    vi.useFakeTimers()
    const results: SmokeResult[] = []
    const w = createSmokeWatcher((r) => results.push(r), 1000)
    w.succeed('SMOKE OK custom')
    w.observe('ERROR', 'boom')
    vi.advanceTimersByTime(2000)
    expect(results).toEqual([{ code: 0, summary: 'SMOKE OK custom' }])
    vi.useRealTimers()
  })
  it('is ignored after a prior settle', () => {
    vi.useFakeTimers()
    const results: SmokeResult[] = []
    const w = createSmokeWatcher((r) => results.push(r), 1000)
    w.observe('ERROR', 'boom')
    w.succeed('too late')
    expect(results).toHaveLength(1)
    expect(results[0].code).toBe(1)
    vi.useRealTimers()
  })
})
