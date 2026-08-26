// packages/app/src/main/select-backend.ts
// Which backend owns the one global-hotkey session on this machine. Extracted
// from index.ts as a pure function so the win32 availability gate — the thing
// standing between a dead keyboard hook and a permanently muted mic — has
// direct unit coverage.
import type { HotkeyBackend } from '../shared/hotkeys.js'

export interface SelectBackendDeps {
  platform: string
  windows: HotkeyBackend
  evdev: HotkeyBackend
  portal: HotkeyBackend
}

export interface BackendChoice {
  backend: HotkeyBackend
  mode: 'passthrough' | 'exclusive'
}

/** Probed on every rebuild (never boot-cached) so the pkexec input-group
 *  unlock upgrades the running app from exclusive to passthrough without a
 *  restart.
 *
 *  On win32 this THROWS when the backend is unavailable rather than returning
 *  it anyway. The Windows poller reads keys through koffi; if koffi failed to
 *  load, its keyDown degrades to a permanently-up key and bindAll would still
 *  hand back a healthy-looking BoundSet. HotkeyService would report ok, the
 *  caller would arm push-to-talk (baseline-muting the mic), and no watcher
 *  could ever deliver the unmute edge — the user streams silent while the UI
 *  says everything is fine. Failing here keeps PTT's failure mode "mic hot". */
export async function selectHotkeyBackend(d: SelectBackendDeps): Promise<BackendChoice> {
  if (d.platform === 'win32') {
    if (!(await d.windows.available())) throw new Error('Global hotkeys are unavailable: the Windows keyboard hook could not be loaded')
    return { backend: d.windows, mode: 'passthrough' }
  }
  return (await d.evdev.available())
    ? { backend: d.evdev, mode: 'passthrough' }
    : { backend: d.portal, mode: 'exclusive' }
}
