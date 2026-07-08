// packages/app/src/main/win32-mute-ops.ts
// Windows PTT mute operations: gates the mic at the OBS input level
// (SetInputMute on 'AxiStream Mic') instead of via pactl / PipeWire.
// Consequence: on Windows PTT gates the stream mic only, not system-wide.
// All calls are best-effort — errors are console.warn'd, never thrown.
import { MIC } from './AudioController.js'
import type { MuteOps } from './PttController.js'

export interface Win32MuteOpsDeps {
  call(req: string, data?: unknown): Promise<unknown>
}

export function createWin32MuteOps(deps: Win32MuteOpsDeps): MuteOps {
  const setMute = async (muted: boolean) => {
    try { await deps.call('SetInputMute', { inputName: MIC, inputMuted: muted }) }
    catch (e) { console.warn('[ptt/win32] SetInputMute failed', e instanceof Error ? e.message : e) }
  }
  return {
    mute: (muted) => setMute(muted),
    // On Windows the OBS input name is fixed ('AxiStream Mic'); the previousSourceId
    // device string is irrelevant — just unmute the OBS input.
    unmuteById: (_id) => setMute(false),
  }
}
