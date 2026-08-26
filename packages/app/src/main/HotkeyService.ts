// packages/app/src/main/HotkeyService.ts
// Owns every global binding — the four hotkey actions AND push-to-talk — on a
// single backend session, because each backend's watcher costs a poller over
// every input device. One watcher, N bindings.
//
// Nothing here may block or delay go-live, and no handler rejection may
// escape: these callbacks run outside any request context, so an unhandled
// rejection would surface as a crash with no renderer to report it.
import { HOTKEY_DESCRIPTIONS, HOTKEY_IDS, type BindSpec, type BoundSet, type HotkeyBackend, type HotkeyBindings, type HotkeyId } from '../shared/hotkeys.js'
import type { PttBinding } from '../shared/keys.js'
import type { AppState } from '../shared/state.js'

export interface HotkeyActions {
  phase(): AppState['phase']
  micEnabled(): boolean
  masksVisible(): boolean
  recordingActive(): boolean
  pttEnabled(): boolean
  goLive(): Promise<void>
  stopStream(): Promise<void>
  setMicEnabled(enabled: boolean): Promise<void>
  setMasksVisible(visible: boolean): Promise<void>
  startRecording(): Promise<{ ok: boolean; error?: string }>
  stopRecording(): Promise<{ ok: boolean; error?: string }>
  /** Must never throw. `fire` is the sole error boundary on the hotkey
   *  path, and it calls this from its own catch handler to report a
   *  failure — a throwing `toast` has nowhere left to be caught and would
   *  escape as an unhandled rejection. Implementations must be best-effort
   *  (catch and log internally), never propagate. */
  toast(kind: 'info' | 'success' | 'error', message: string): void
}

export interface HotkeyServiceDeps {
  selectBackend(): Promise<{ backend: HotkeyBackend; mode: 'passthrough' | 'exclusive' }>
  bindings(): HotkeyBindings
  pttBinding(): PttBinding | null
  actions: HotkeyActions
  onPttEdge(down: boolean): void
  onMode(mode: 'passthrough' | 'exclusive' | null): void
  now(): number
}

/** Ending a live broadcast is the one irreversible direction, so it takes a
 *  confirming second press. */
export const END_STREAM_CONFIRM_MS = 2000

export const PTT_ID = 'ptt'

export class HotkeyService {
  private set: BoundSet | null = null
  private endArmedAt = 0

  constructor(private readonly d: HotkeyServiceDeps) {}

  async rebuild(): Promise<{ ok: boolean; error?: string }> {
    await this.close()
    const bindings = this.d.bindings()
    const ptt = this.d.pttBinding()
    const specs: BindSpec[] = []
    for (const id of HOTKEY_IDS) {
      const b = bindings[id]
      if (b) specs.push({ id, description: HOTKEY_DESCRIPTIONS[id], binding: b })
    }
    if (ptt) specs.push({ id: PTT_ID, description: 'Push to talk', binding: ptt })
    if (specs.length === 0) {
      this.d.onMode(null)
      return { ok: true }
    }
    try {
      const { backend, mode } = await this.d.selectBackend()
      const set = await backend.bindAll(specs)
      set.onActivated((id) => {
        if (id === PTT_ID) { this.d.onPttEdge(true); return }
        void this.fire(id as HotkeyId)
      })
      set.onDeactivated((id) => { if (id === PTT_ID) this.d.onPttEdge(false) })
      this.set = set
      this.d.onMode(mode)
      return { ok: true }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.warn('[hotkeys] bind failed', error)
      this.d.onMode(null)
      return { ok: false, error }
    }
  }

  async close(): Promise<void> {
    if (!this.set) return
    const set = this.set
    this.set = null
    try { await set.close() } catch { /* best-effort */ }
  }

  /** Dispatch one action. Always resolves — a throwing handler becomes a
   *  toast, never an unhandled rejection. */
  async fire(id: HotkeyId): Promise<void> {
    const a = this.d.actions
    // Any action other than a repeat go-live press cancels the pending
    // end-stream confirmation, so an unrelated keypress can't leave the
    // stream one accidental press from dying.
    if (id !== 'goLive') this.endArmedAt = 0
    try {
      if (id === 'goLive') { await this.fireGoLive(); return }
      if (id === 'micMute') {
        if (a.pttEnabled()) { a.toast('info', 'Mic is controlled by push-to-talk.'); return }
        const next = !a.micEnabled()
        await a.setMicEnabled(next)
        a.toast('success', next ? 'Mic on' : 'Mic muted')
        return
      }
      if (id === 'masks') {
        const next = !a.masksVisible()
        await a.setMasksVisible(next)
        a.toast('success', next ? 'Masks shown' : 'Masks hidden')
        return
      }
      if (a.recordingActive()) {
        const r = await a.stopRecording()
        a.toast(r.ok ? 'success' : 'error', r.ok ? 'Recording stopped' : (r.error ?? 'Could not stop recording'))
      } else {
        const r = await a.startRecording()
        a.toast(r.ok ? 'success' : 'error', r.ok ? 'Recording started' : (r.error ?? 'Could not start recording'))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[hotkeys] ${id} failed`, msg)
      // toast is documented as never-throwing, but this is the sole error
      // boundary on the hotkey path — a broken dep must not escape it.
      try { a.toast('error', msg) } catch { /* best-effort */ }
    }
  }

  private async fireGoLive(): Promise<void> {
    const a = this.d.actions
    const phase = a.phase()
    if (phase === 'LIVE' || phase === 'RECONNECTING') {
      const now = this.d.now()
      if (this.endArmedAt && now - this.endArmedAt <= END_STREAM_CONFIRM_MS) {
        this.endArmedAt = 0
        await a.stopStream()
        a.toast('success', 'Ending the stream…')
        return
      }
      this.endArmedAt = now
      a.toast('info', 'Press again to end the stream')
      return
    }
    this.endArmedAt = 0
    if (phase === 'READY') { await a.goLive(); return }
    // A hotkey never opens a modal and never steals focus: the user is in
    // fullscreen and cannot see either. It explains itself and stops.
    a.toast('info', blockerFor(phase))
  }
}

function blockerFor(phase: AppState['phase']): string {
  if (phase === 'NEEDS_YOUTUBE') return 'Connect YouTube first'
  if (phase === 'NEEDS_TITLE') return 'Open AxiStream to set a stream title'
  if (phase === 'GOING_LIVE' || phase === 'STARTING_ON_YOUTUBE') return 'Already going live…'
  if (phase === 'ERROR') return 'AxiStream needs attention — open the window'
  return 'Set up capture first'
}
