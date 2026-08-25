import { describe, it, expect } from 'vitest'
import { createSummaryAccumulator } from '../src/main/stream-summary.js'
import type { LiveStats } from '../src/shared/state.js'

const stat = (p: Partial<LiveStats>): LiveStats => ({
  bitrateKbps: 0, droppedFrames: 0, droppedPct: 0, durationMs: 0,
  encoder: 'NVENC H.264', cpuPct: 0, reconnecting: false, ...p,
})

const EXTRA = { watchUrl: null, recordingPath: null, recordingStillActive: false, endedWithError: false }

describe('createSummaryAccumulator', () => {
  it('averages bitrate excluding zero samples', () => {
    const a = createSummaryAccumulator()
    // OBS reports 0 on the first tick or two and during a reconnect; averaging
    // those in would understate a healthy stream.
    a.sample(stat({ bitrateKbps: 0 }))
    a.sample(stat({ bitrateKbps: 6000 }))
    a.sample(stat({ bitrateKbps: 6200 }))

    expect(a.snapshot(EXTRA).avgBitrateKbps).toBe(6100)
  })

  it('takes cumulative dropped figures from the last sample', () => {
    const a = createSummaryAccumulator()
    a.sample(stat({ droppedFrames: 10, droppedPct: 0.5 }))
    a.sample(stat({ droppedFrames: 42, droppedPct: 0.2 }))

    const s = a.snapshot(EXTRA)
    expect(s.droppedFrames).toBe(42)
    expect(s.droppedPct).toBe(0.2)
  })

  it('retains the peak dropped percentage even after it recovers', () => {
    const a = createSummaryAccumulator()
    a.sample(stat({ droppedPct: 0.1 }))
    a.sample(stat({ droppedPct: 3.4 }))
    a.sample(stat({ droppedPct: 0.2 }))

    expect(a.snapshot(EXTRA).peakDroppedPct).toBe(3.4)
  })

  it('takes duration and encoder from the last sample', () => {
    const a = createSummaryAccumulator()
    a.sample(stat({ durationMs: 1000, encoder: 'NVENC H.264' }))
    a.sample(stat({ durationMs: 7_200_000, encoder: 'x264' }))

    const s = a.snapshot(EXTRA)
    expect(s.durationMs).toBe(7_200_000)
    expect(s.encoder).toBe('x264')
  })

  it('yields zeros rather than NaN when no samples arrived', () => {
    const a = createSummaryAccumulator()

    const s = a.snapshot(EXTRA)
    expect(s.avgBitrateKbps).toBe(0)
    expect(s.durationMs).toBe(0)
    expect(s.droppedFrames).toBe(0)
    expect(Number.isNaN(s.avgBitrateKbps)).toBe(false)
  })

  it('yields zero average when every sample was zero', () => {
    const a = createSummaryAccumulator()
    a.sample(stat({ bitrateKbps: 0 }))
    a.sample(stat({ bitrateKbps: 0 }))

    expect(a.snapshot(EXTRA).avgBitrateKbps).toBe(0)
  })

  it('passes the extras straight through', () => {
    const a = createSummaryAccumulator()
    a.sample(stat({ bitrateKbps: 6000 }))

    const s = a.snapshot({
      watchUrl: 'https://youtu.be/abc', recordingPath: '/home/u/v.mp4',
      recordingStillActive: true, endedWithError: true,
    })
    expect(s.watchUrl).toBe('https://youtu.be/abc')
    expect(s.recordingPath).toBe('/home/u/v.mp4')
    expect(s.recordingStillActive).toBe(true)
    expect(s.endedWithError).toBe(true)
  })

  it('clears everything on reset', () => {
    const a = createSummaryAccumulator()
    a.sample(stat({ bitrateKbps: 6000, durationMs: 9000, droppedFrames: 5 }))
    a.reset()

    const s = a.snapshot(EXTRA)
    expect(s.avgBitrateKbps).toBe(0)
    expect(s.durationMs).toBe(0)
    expect(s.droppedFrames).toBe(0)
  })
})
