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
  encoderLabel?: () => string
  onStartFailure?: () => Promise<boolean>
  /** Max callReady attempts for SetStreamServiceSettings/StartStream — tests pass 1 for speed. */
  startTries?: number
}

export class StreamController {
  private timer: ReturnType<typeof setInterval> | null = null
  private live = false
  private lastBytes = 0
  private firstSample = true
  private hooks: GoLiveHooks = {}
  private retried = false
  private generation = 0
  constructor(private readonly d: StreamDeps) {}

  isLive(): boolean { return this.live }

  async goLive(target: Ingest, hooks: GoLiveHooks = {}): Promise<void> {
    if (this.live || this.timer) return
    this.generation++
    this.hooks = hooks
    this.retried = false
    await this.start(target)
  }

  private async start(target: Ingest): Promise<void> {
    const c = this.d.client()
    const startOpts = this.d.startTries !== undefined ? { tries: this.d.startTries } : {}
    await callReady(() => c.call('SetStreamServiceSettings', {
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: { server: target.server, key: target.key },
    }), startOpts)
    await callReady(() => c.call('StartStream'), startOpts)
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
        if (ticks >= deadline) await this.failStart(c, target, true)
        return
      }
      if (st.outputActive && !becameLive) {
        becameLive = true
        try { await this.hooks.onIngestActive?.() }
        catch { await this.failStart(c, target, false); return }
        this.live = true
      }
      // Only claim LIVE once onIngestActive has resolved (this.live). Stats still
      // flow during the wait so the UI can show a real bitrate immediately.
      if (this.live) this.d.onPhase(st.outputReconnecting ? 'RECONNECTING' : 'LIVE')
      this.d.onStats(this.mapStats(st, pollMs))
    }, pollMs)
  }

  private async failStart(c: { call(r: string): Promise<any> }, target: Ingest, canRetry: boolean): Promise<void> {
    this.clear()
    try { await c.call('StopStream') } catch { /* ignore */ }
    const gen = this.generation
    if (canRetry && !this.retried && this.d.onStartFailure) {
      this.retried = true
      let retry = false
      try { retry = await this.d.onStartFailure() } catch { /* treated as no-retry */ }
      // An interleaved stop() or goLive() already handled teardown — abort.
      if (gen !== this.generation) return
      // Retry restarts the push without touching hooks.onStop — onStop
      // completes the YouTube broadcast, which would kill the session the
      // retry is trying to save.
      if (retry) {
        try { await this.start(target); return } catch { /* fall through to terminal failure */ }
      }
    }
    // Check again: a stop()/goLive() could have fired during the retry's start().
    if (gen !== this.generation) return
    try { await this.hooks.onStop?.() } catch { /* ignore */ }
    this.live = false
    this.d.onPhase('ERROR', "Couldn't start stream — check your key and connection.")
  }

  private mapStats(st: any, pollMs: number): LiveStats {
    const encoder = this.d.encoderLabel?.() ?? 'x264'
    const bytes = Number(st.outputBytes ?? 0)
    const total = Number(st.outputTotalFrames ?? 0)
    const skipped = Number(st.outputSkippedFrames ?? 0)
    const droppedPct = total > 0 ? Math.round((skipped / total) * 1000) / 10 : 0
    if (this.firstSample) { this.firstSample = false; this.lastBytes = bytes; return { bitrateKbps: 0, droppedFrames: Number(st.outputSkippedFrames ?? 0), droppedPct, durationMs: Number(st.outputDuration ?? 0), encoder, cpuPct: Math.round(Number(st.outputCongestion ?? 0) * 100), reconnecting: !!st.outputReconnecting } }
    const delta = Math.max(0, bytes - this.lastBytes)
    this.lastBytes = bytes
    const bitrateKbps = Math.round((delta * 8) / 1000 / (pollMs / 1000))
    return {
      bitrateKbps,
      droppedFrames: Number(st.outputSkippedFrames ?? 0),
      droppedPct,
      durationMs: Number(st.outputDuration ?? 0),
      encoder,
      cpuPct: Math.round(Number(st.outputCongestion ?? 0) * 100),
      reconnecting: !!st.outputReconnecting,
    }
  }

  async stop(): Promise<void> {
    this.generation++
    this.clear()
    try { await this.d.client().call('StopStream') } catch { /* ignore */ }
    try { await this.hooks.onStop?.() } catch { /* ignore */ }
    this.live = false
    this.d.onPhase('READY')
  }

  private clear(): void { if (this.timer) { clearInterval(this.timer); this.timer = null } }
}
