import { OBSWebSocket, EventSubscription } from 'obs-websocket-js'
import type { AudioLevels } from '../shared/state.js'
export type { AudioLevels }

const NAME_TO_KEY: Record<string, keyof AudioLevels> = {
  'AxiStream Desktop Audio': 'desktop',
  'AxiStream Mic': 'mic',
  'AxiStream Game Audio': 'game',
}

export interface MeterDeps {
  info(): { url: string; password: string } | null
  onLevels(l: AudioLevels): void
  makeClient?: () => OBSWebSocket
  backoffMs?: number
  throttleMs?: number
}

/** Streams OBS volume meters over a DEDICATED websocket connection (the
 *  InputVolumeMeters subscription is high-volume; keeping it off the
 *  sidecar's control connection isolates the noise). Best-effort: quiet
 *  retry loop while started, never throws out. */
export class AudioLevelMeter {
  private started = false
  private client: OBSWebSocket | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastPush = 0
  // Resolved when stop() is called so the loop can exit even if
  // ConnectionClosed never fires (e.g. in tests with a fake client).
  private stopResolve: (() => void) | null = null
  private stopSignal: Promise<void> = Promise.resolve()

  constructor(private readonly d: MeterDeps) {}

  start(): void {
    if (this.started) return
    this.started = true
    this.stopSignal = new Promise<void>((resolve) => { this.stopResolve = resolve })
    void this.loop()
  }

  private async loop(): Promise<void> {
    while (this.started) {
      const info = this.d.info()
      if (info) {
        try {
          const c = (this.d.makeClient ?? (() => new OBSWebSocket()))()
          this.client = c
          c.on('InputVolumeMeters' as never, ((data: { inputs?: { inputName: string; inputLevelsMul: number[][] }[] }) => this.handle(data)) as never)
          const closed = new Promise<void>((resolve) => { c.on('ConnectionClosed' as never, (() => resolve()) as never) })
          await c.connect(info.url, info.password, { eventSubscriptions: EventSubscription.InputVolumeMeters })
          // Race: stay until the connection drops OR stop() is called
          await Promise.race([closed, this.stopSignal])
        } catch { /* fall through to backoff */ }
        this.client = null
      }
      if (!this.started) return
      await new Promise<void>((resolve) => { this.timer = setTimeout(resolve, this.d.backoffMs ?? 3000) })
    }
  }

  private handle(data: { inputs?: { inputName: string; inputLevelsMul: number[][] }[] }): void {
    const now = Date.now()
    if (now - this.lastPush < (this.d.throttleMs ?? 100)) return
    this.lastPush = now
    const levels: AudioLevels = { desktop: 0, mic: 0, game: 0 }
    for (const input of data.inputs ?? []) {
      const key = NAME_TO_KEY[input.inputName]
      if (!key) continue
      const peak = Math.max(0, ...(input.inputLevelsMul ?? []).map((ch) => ch[0] ?? 0))
      levels[key] = Math.min(1, peak)
    }
    this.d.onLevels(levels)
  }

  async stop(): Promise<void> {
    this.started = false
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.stopResolve?.()
    this.stopResolve = null
    try { await this.client?.disconnect() } catch { /* ignore */ }
    this.client = null
  }
}
