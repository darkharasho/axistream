// packages/app/src/main/PttController.ts
import { type PttBinding } from '../shared/keys.js'
export interface PortalShortcut { onActivated(cb: () => void): void; onDeactivated(cb: () => void): void; close(): Promise<void> }
export interface PortalDeps {
  available(): Promise<boolean>
  bind(id: string, description: string, binding: PttBinding): Promise<PortalShortcut>
}
export type ExecLike = (cmd: string, args: string[]) => Promise<void>
export interface PttDeps { portal: PortalDeps; exec: ExecLike; sourceId(): string; onActive(active: boolean): void; binding(): PttBinding }

// App-owned push-to-talk: a GlobalShortcuts-portal key gates the mic at the
// PipeWire SOURCE level, so Discord (on voice activity) and the stream both
// follow one mute point. Failure mode is always "mic hot" — disable/restore
// unmute; nothing here may block boot or go-live.
export class PttController {
  private shortcut: PortalShortcut | null = null
  constructor(private readonly d: PttDeps) {}

  isEnabled(): boolean { return this.shortcut !== null }

  async available(): Promise<boolean> {
    try { return await this.d.portal.available() } catch { return false }
  }

  private async setMute(muted: boolean): Promise<void> {
    try { await this.d.exec('pactl', ['set-source-mute', this.d.sourceId(), muted ? '1' : '0']) }
    catch (e) { console.warn('[ptt] set-source-mute failed', e instanceof Error ? e.message : e) }
  }

  async enable(): Promise<{ ok: boolean; error?: string }> {
    if (this.shortcut) return { ok: true }
    let sc: PortalShortcut
    try {
      sc = await this.d.portal.bind('ptt', 'Push to talk', this.d.binding())
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn('[ptt] bind failed', msg)
      return { ok: false, error: msg }
    }
    this.shortcut = sc
    // onActive fires before the async unmute completes on purpose — instant
    // UI feedback; the mic follows within the pactl round-trip.
    sc.onActivated(() => { void this.setMute(false); this.d.onActive(true) })
    sc.onDeactivated(() => { void this.setMute(true); this.d.onActive(false) })
    await this.setMute(true)
    return { ok: true }
  }

  async disable(): Promise<void> {
    if (!this.shortcut) return
    try { await this.shortcut.close() } catch { /* best-effort */ }
    this.shortcut = null
    await this.setMute(false)
    this.d.onActive(false)
  }

  async restore(): Promise<void> { await this.setMute(false) }

  // The mic device changed while PTT is enabled: the baseline mute lives on
  // the OLD source — unmute it (never strand it) and baseline-mute the new
  // one (sourceId() already resolves to it). No-op when disabled.
  async rearmSource(previousSourceId: string): Promise<void> {
    if (!this.shortcut) return
    try { await this.d.exec('pactl', ['set-source-mute', previousSourceId, '0']) }
    catch (e) { console.warn('[ptt] unmuting previous source failed', e instanceof Error ? e.message : e) }
    await this.setMute(true)
  }
}
