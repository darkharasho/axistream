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

  it('stats report the injected encoder label', async () => {
    const c = clientFrom([{ outputActive: true, outputReconnecting: false, outputBytes: 1 }])
    const stats: any[] = []
    const sc = new StreamController({ client: c.client, onPhase: () => {}, onStats: (s) => stats.push(s), pollMs: 5, encoderLabel: () => 'NVENC' })
    await sc.goLive(ingest)
    await new Promise((r) => setTimeout(r, 30))
    await sc.stop()
    expect(stats.length).toBeGreaterThan(0)
    expect(stats.every((s) => s.encoder === 'NVENC')).toBe(true)
  })

  it('retries once via onStartFailure without running onStop, then goes LIVE', async () => {
    // Never active until after the retry's StartStream, then active.
    let started = 0
    const client = () => ({
      call: vi.fn(async (req: string) => {
        if (req === 'StartStream') started++
        if (req === 'GetStreamStatus') return { outputActive: started >= 2, outputReconnecting: false, outputBytes: 1 }
        return {}
      }),
    })
    const phases: string[] = []
    let stopped = false
    let fallbacks = 0
    const sc = new StreamController({
      client, onPhase: (p) => phases.push(p), onStats: () => {}, pollMs: 5, goLiveTimeoutMs: 15,
      onStartFailure: async () => { fallbacks++; return true },
    })
    await sc.goLive(ingest, { onStop: async () => { stopped = true } })
    await new Promise((r) => setTimeout(r, 120))
    expect(fallbacks).toBe(1)
    expect(started).toBe(2)
    expect(phases).toContain('LIVE')
    expect(phases).not.toContain('ERROR')
    expect(stopped).toBe(false) // onStop must NOT fire on the retry path
    await sc.stop()
  })

  it('reports ERROR (and runs onStop) when the retry also fails', async () => {
    const c = clientFrom([{ outputActive: false, outputReconnecting: false, outputBytes: 0 }])
    const phases: string[] = []
    let stopped = false
    let fallbacks = 0
    const sc = new StreamController({
      client: c.client, onPhase: (p) => phases.push(p), onStats: () => {}, pollMs: 5, goLiveTimeoutMs: 15,
      onStartFailure: async () => { fallbacks++; return true },
    })
    await sc.goLive(ingest, { onStop: async () => { stopped = true } })
    await new Promise((r) => setTimeout(r, 200))
    expect(fallbacks).toBe(1) // once per goLive, not once per failure
    expect(phases).toContain('ERROR')
    expect(stopped).toBe(true)
  })

  it('onStartFailure throwing falls through to ERROR', async () => {
    const c = clientFrom([{ outputActive: false, outputReconnecting: false, outputBytes: 0 }])
    const phases: string[] = []
    const sc = new StreamController({
      client: c.client, onPhase: (p) => phases.push(p), onStats: () => {}, pollMs: 5, goLiveTimeoutMs: 15,
      onStartFailure: async () => { throw new Error('apply failed') },
    })
    await sc.goLive(ingest)
    await new Promise((r) => setTimeout(r, 90))
    expect(phases).toContain('ERROR')
  })

  it('Fix1: throwing retry lands in ERROR with onStop fired, no unhandled rejection', async () => {
    // First SetStreamServiceSettings succeeds, first StartStream succeeds, GetStreamStatus never active →
    // triggers failStart; onStartFailure returns true; retry's SetStreamServiceSettings throws every time.
    let startStreamCount = 0
    let setServiceCount = 0
    const client = () => ({
      call: vi.fn(async (req: string) => {
        if (req === 'SetStreamServiceSettings') {
          setServiceCount++
          if (setServiceCount > 1) throw new Error('OBS not ready')
          return {}
        }
        if (req === 'StartStream') { startStreamCount++; return {} }
        if (req === 'GetStreamStatus') return { outputActive: false, outputReconnecting: false, outputBytes: 0 }
        return {}
      }),
    })
    const phases: string[] = []
    let stopped = false
    const sc = new StreamController({
      client, onPhase: (p) => phases.push(p), onStats: () => {}, pollMs: 5, goLiveTimeoutMs: 15,
      startTries: 1, // keep callReady fast — 1 try, no delay
      onStartFailure: async () => true,
    })
    await sc.goLive(ingest, { onStop: async () => { stopped = true } })
    await new Promise((r) => setTimeout(r, 200))
    expect(phases).toContain('ERROR')
    expect(stopped).toBe(true)
  })

  it('Fix2: stop() during pending onStartFailure aborts retry, no duplicate StartStream or ERROR', async () => {
    let resolveHook!: (v: boolean) => void
    const hookPromise = new Promise<boolean>((res) => { resolveHook = res })
    let startStreamCount = 0
    const client = () => ({
      call: vi.fn(async (req: string) => {
        if (req === 'StartStream') startStreamCount++
        if (req === 'GetStreamStatus') return { outputActive: false, outputReconnecting: false, outputBytes: 0 }
        return {}
      }),
    })
    const phases: string[] = []
    let stopCount = 0
    const sc = new StreamController({
      client, onPhase: (p) => phases.push(p), onStats: () => {}, pollMs: 5, goLiveTimeoutMs: 15,
      startTries: 1,
      onStartFailure: () => hookPromise,
    })
    await sc.goLive(ingest, { onStop: async () => { stopCount++ } })
    // Wait long enough for failStart to be waiting on the hook
    await new Promise((r) => setTimeout(r, 60))
    // Stop while hook is pending
    await sc.stop()
    expect(phases).toContain('READY')
    expect(stopCount).toBe(1)
    const startStreamBeforeResolve = startStreamCount
    // Now resolve the hook with true — retry should be aborted by generation guard
    resolveHook(true)
    await new Promise((r) => setTimeout(r, 60))
    expect(startStreamCount).toBe(startStreamBeforeResolve) // no new StartStream issued
    expect(phases).not.toContain('ERROR') // aborted failStart must not emit ERROR
  })
})
