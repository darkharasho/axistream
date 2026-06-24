import { describe, it, expect, vi } from 'vitest'
import { StreamController } from '../src/main/StreamController.js'

function clientFrom(statuses: any[]) {
  let i = 0
  const calls: string[] = []
  return {
    calls,
    client: () => ({
      call: vi.fn(async (req: string) => {
        calls.push(req)
        if (req === 'GetStreamStatus') return statuses[Math.min(i++, statuses.length - 1)]
        return {}
      }),
    }),
  }
}

describe('StreamController', () => {
  it('goLive sets service, starts, reaches LIVE, emits stats', async () => {
    const c = clientFrom([
      { outputActive: true, outputReconnecting: false, outputDuration: 1000, outputBytes: 100000, outputSkippedFrames: 0, outputTotalFrames: 60 },
    ])
    const phases: string[] = []
    const stats: any[] = []
    const sc = new StreamController({
      client: c.client, onPhase: (p) => phases.push(p), onStats: (s) => stats.push(s),
      pollMs: 5, goLiveTimeoutMs: 500,
    })
    await sc.goLive('key-7f3a')
    await new Promise((r) => setTimeout(r, 30))
    await sc.stop()
    expect(c.calls).toContain('SetStreamServiceSettings')
    expect(c.calls).toContain('StartStream')
    expect(phases).toContain('GOING_LIVE')
    expect(phases).toContain('LIVE')
    expect(stats[0].bitrateKbps).toBeGreaterThanOrEqual(0)
    expect(sc.isLive()).toBe(false) // stopped
  })

  it('emits ERROR and stops if the stream never goes active before timeout', async () => {
    const c = clientFrom([{ outputActive: false, outputReconnecting: false, outputBytes: 0 }])
    const phases: string[] = []
    const sc = new StreamController({ client: c.client, onPhase: (p) => phases.push(p), onStats: () => {}, pollMs: 5, goLiveTimeoutMs: 40 })
    await sc.goLive('key')
    await new Promise((r) => setTimeout(r, 90))
    expect(phases).toContain('ERROR')
    expect(c.calls).toContain('StopStream')
  })
})
