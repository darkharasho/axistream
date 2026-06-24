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

const ingest = { server: 'rtmps://x/live2', key: 'KEY' }

describe('StreamController', () => {
  it('goLive sets service from target, starts, reaches LIVE', async () => {
    const c = clientFrom([{ outputActive: true, outputReconnecting: false, outputBytes: 1 }])
    const phases: string[] = []
    const sc = new StreamController({ client: c.client, onPhase: (p) => phases.push(p), onStats: () => {}, pollMs: 5 })
    await sc.goLive(ingest)
    await new Promise((r) => setTimeout(r, 30))
    expect(c.calls).toContain('SetStreamServiceSettings')
    expect(c.calls).toContain('StartStream')
    expect(phases).toContain('LIVE')
  })

  it('awaits onIngestActive before declaring LIVE, and onStop on stop', async () => {
    const c = clientFrom([{ outputActive: true, outputReconnecting: false, outputBytes: 1 }])
    const order: string[] = []
    const sc = new StreamController({ client: c.client, onPhase: (p) => order.push(`phase:${p}`), onStats: () => {}, pollMs: 5 })
    await sc.goLive(ingest, {
      onIngestActive: async () => { order.push('activate') },
      onStop: async () => { order.push('stop') },
    })
    await new Promise((r) => setTimeout(r, 30))
    expect(order.indexOf('activate')).toBeLessThan(order.indexOf('phase:LIVE'))
    await sc.stop()
    expect(order).toContain('stop')
  })

  it('emits ERROR, stops, and runs onStop if never active before timeout', async () => {
    const c = clientFrom([{ outputActive: false, outputReconnecting: false, outputBytes: 0 }])
    const phases: string[] = []
    let cleaned = false
    const sc = new StreamController({ client: c.client, onPhase: (p) => phases.push(p), onStats: () => {}, pollMs: 5, goLiveTimeoutMs: 20 })
    await sc.goLive(ingest, { onStop: async () => { cleaned = true } })
    await new Promise((r) => setTimeout(r, 90))
    expect(phases).toContain('ERROR')
    expect(cleaned).toBe(true)
  })
})
