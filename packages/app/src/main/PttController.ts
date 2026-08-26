// packages/app/src/main/PttController.ts
export interface MuteOps {
  mute(muted: boolean): Promise<void>
  unmuteById(id: string): Promise<void>
}
export interface PttDeps { muteOps: MuteOps; onActive(active: boolean): void; available(): Promise<boolean> }

// App-owned push-to-talk: gates the mic at the PipeWire SOURCE level (Linux)
// or OBS input level (Windows), so Discord (on voice activity) and the
// stream both follow one mute point. Failure mode is always "mic hot" —
// disarm/restore unmute; nothing here may block boot or go-live.
//
// The key edge itself is no longer bound here — HotkeyService owns the
// single shared backend session and calls onEdge() when the 'ptt' shortcut's
// key goes down/up.
export class PttController {
  private enabled = false
  constructor(private readonly d: PttDeps) {}

  isEnabled(): boolean { return this.enabled }

  async available(): Promise<boolean> {
    try { return await this.d.available() } catch { return false }
  }

  private async setMute(muted: boolean): Promise<void> {
    try { await this.d.muteOps.mute(muted) }
    catch (e) { console.warn('[ptt] set-mute failed', e instanceof Error ? e.message : e) }
  }

  /** Called by HotkeyService when the 'ptt' shortcut's key goes down/up.
   *  onActive fires before the async unmute completes on purpose — instant UI
   *  feedback; the mic follows within the mute-op round trip. */
  onEdge(down: boolean): void {
    if (!this.enabled) return
    void this.setMute(!down)
    this.d.onActive(down)
  }

  /** Arming is now just the baseline mute — HotkeyService owns the binding.
   *  Deliberately NOT guarded against re-arming while already enabled:
   *  rebuildHotkeys() calls this after every hotkey rebuild (any binding
   *  change, not just PTT's own) as a safety net for the gap where no
   *  hotkey — PTT included — is live, so it must re-apply the baseline mute
   *  every time, not just on the first arm. */
  async arm(): Promise<void> {
    this.enabled = true
    await this.setMute(true)
  }

  async disarm(): Promise<void> {
    if (!this.enabled) return
    this.enabled = false
    await this.setMute(false)
    this.d.onActive(false)
  }

  async restore(): Promise<void> { await this.setMute(false) }

  // The mic device changed while PTT is enabled: the baseline mute lives on
  // the OLD source — unmute it (never strand it) and baseline-mute the new
  // one. No-op when disabled.
  async rearmSource(previousSourceId: string): Promise<void> {
    if (!this.enabled) return
    try { await this.d.muteOps.unmuteById(previousSourceId) }
    catch (e) { console.warn('[ptt] unmuting previous source failed', e instanceof Error ? e.message : e) }
    await this.setMute(true)
  }
}
