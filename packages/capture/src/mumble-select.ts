// packages/capture/src/mumble-select.ts
// Which MumbleLink reader this machine has. Pure and injected, mirroring
// select-backend.ts, so the platform arms have direct coverage on either OS.
import { readIdentity, type MumbleDeps, type MumbleIdentity } from './mumble-reader.js'
import { readIdentityWindows, type WindowsMumbleDeps } from './mumble-windows.js'

export interface MumbleSelectDeps {
  platform: string
  linux: MumbleDeps
  windows: WindowsMumbleDeps
}

/** Never throws, unlike selectHotkeyBackend's win32 gate: an unavailable
 *  reader costs a variable in a stream title, and `null` — "GW2 not found" —
 *  is already the answer every caller handles. */
export function readGw2Identity(d: MumbleSelectDeps): MumbleIdentity | null {
  try {
    return d.platform === 'win32' ? readIdentityWindows(d.windows) : readIdentity(d.linux)
  } catch { return null }
}
