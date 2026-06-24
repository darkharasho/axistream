export interface PreviewPumpDeps {
  client(): { call(req: string, data?: any): Promise<any> }
  sourceName: string
  emit(dataUrl: string): void
  intervalMs?: number
}

export class PreviewPump {
  private timer: ReturnType<typeof setInterval> | null = null
  private visible = true
  private inFlight = false
  constructor(private readonly d: PreviewPumpDeps) {}

  setVisible(v: boolean): void { this.visible = v }

  start(): void {
    if (this.timer) return
    // ~12fps target; the inFlight guard caps the real rate at the screenshot
    // round-trip, so this never overlaps.
    const ms = this.d.intervalMs ?? 80
    this.timer = setInterval(() => { void this.tick() }, ms)
  }

  private async tick(): Promise<void> {
    if (!this.visible || this.inFlight) return
    this.inFlight = true
    try {
      // JPEG is far smaller/faster to encode + ship over IPC than PNG for a
      // photo-like game frame — the difference between choppy and smooth.
      const shot = await this.d.client().call('GetSourceScreenshot', {
        sourceName: this.d.sourceName, imageFormat: 'jpg', imageWidth: 640, imageCompressionQuality: 72,
      })
      if (shot?.imageData) this.d.emit(shot.imageData)
    } catch { /* skip this frame */ } finally { this.inFlight = false }
  }

  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null } }
}
