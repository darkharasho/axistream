import { CH, type ToastPayload } from '../shared/state.js'

/** Minimal structural shape of what we need from a BrowserWindow, so this
    helper is unit-testable without Electron. */
export interface ToastTarget {
  isDestroyed(): boolean
  webContents: { send(channel: string, payload: unknown): void }
}

/**
 * Push a one-off notification to the renderer.
 *
 * Conditions belong in AppState; this channel carries discrete events only.
 * Best-effort like every other renderer push — it warns and never throws out,
 * so no go-live or capture path can fail because of a notification.
 */
export function toast(win: ToastTarget | null, payload: ToastPayload): void {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(CH.evtToast, payload)
  } catch (e) {
    console.warn('[toast] failed to push', e)
  }
}
