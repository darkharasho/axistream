import { callReady } from '@axistream/capture'
import type { LiveStats } from '../shared/state.js'

export interface Ingest { server: string; key: string }
export interface GoLiveHooks {
  onIngestActive?: () => Promise<void>
  onStop?: () => Promise<void>
}

type Phase = 'GOING_LIVE' | 'LIVE' | 'RECONNECTING' | 'READY' | 'ERROR'
export interface StreamDeps {
  client(): { call(req: string, data?: any): Promise<any> }
  onStats(s: LiveStats): void
  onPhase(p: Phase, error?: string): void
  pollMs?: number
  goLiveTimeoutMs?: number
}

export class StreamController {
  private timer: ReturnType<typeof setInterval> | null = null
  private live = false
  private lastBytes = 0
  private firstSample = true
  private hooks: GoLiveHooks = {}
  constructor(private readonly d: StreamDeps) {}

  isLive(): boolean { return this.live }

  async goLive(target: Ingest, hooks: GoLiveHooks = {}): Promise<void> {
    if (this.live || this.timer) return
    this.hooks = hooks
    const c = this.d.client()
    await callReady(() => c.call('SetStreamServiceSettings', {
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: { server: target.server, key: target.key },
    }))
    await callReady(() => c.call('StartStream'))
    this.d.onPhase('GOING_LIVE')
    this.lastBytes = 0
    this.firstSample = true
    const pollMs = this.d.pollMs ?? 1000
    const deadline = (this.d.goLiveTimeoutMs ?? 15000) / pollMs
    let ticks = 0
    let becameLive = false
    this.timer = setInterval(async () => {
      ticks++
      let st: any
      try { st = await c.call('GetStreamStatus') } catch { return }
      if (!st.outputActive && !becameLive) {
        if (ticks >= deadline) await this.failStart(c)
        return
      }
      if (st.outputActive && !becameLive) {
        becameLive = true
        try { await this.hooks.onIngestActive?.() }
        catch { await this.failStart(c); return }
        this.live = true
        this.d.onPhase('LIVE')
      }
      this.d.onPhase(st.outputReconnecting ? 'RECONNECTING' : 'LIVE')
      this.d.onStats(this.mapStats(st, pollMs))
    }, pollMs)
  }

  private async failStart(c: { call(r: string): Promise<any> }): Promise<void> {
    this.clear()
    try { await c.call('StopStream') } catch { /* ignore */ }
    try { await this.hooks.onStop?.() } catch { /* ignore */ }
    this.live = false
    this.d.onPhase('ERROR', "Couldn't start stream — check your key and connection.")
  }

  private mapStats(st: any, pollMs: number): LiveStats {
    const bytes = Number(st.outputBytes ?? 0)
    if (this.firstSample) { this.firstSample = false; this.lastBytes = bytes; return { bitrateKbps: 0, droppedFrames: Number(st.outputSkippedFrames ?? 0), durationMs: Number(st.outputDuration ?? 0), encoder: 'x264', cpuPct: Math.round(Number(st.outputCongestion ?? 0) * 100), reconnecting: !!st.outputReconnecting } }
    const delta = Math.max(0, bytes - this.lastBytes)
    this.lastBytes = bytes
    const bitrateKbps = Math.round((delta * 8) / 1000 / (pollMs / 1000))
    return {
      bitrateKbps,
      droppedFrames: Number(st.outputSkippedFrames ?? 0),
      durationMs: Number(st.outputDuration ?? 0),
      encoder: 'x264',
      cpuPct: Math.round(Number(st.outputCongestion ?? 0) * 100),
      reconnecting: !!st.outputReconnecting,
    }
  }

  async stop(): Promise<void> {
    this.clear()
    try { await this.d.client().call('StopStream') } catch { /* ignore */ }
    try { await this.hooks.onStop?.() } catch { /* ignore */ }
    this.live = false
    this.d.onPhase('READY')
  }

  private clear(): void { if (this.timer) { clearInterval(this.timer); this.timer = null } }
}
