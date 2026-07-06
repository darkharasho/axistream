import { callReady } from './call-ready.js'
import type { EncoderPreset } from './encoder-presets.js'

export interface ApplyEncoderDeps {
  call: (req: string, params?: object) => Promise<unknown>
  // Retry bounds (OBS rejects profile requests with code 600 briefly after
  // startup). Defaults match callReady; tests pass small values.
  tries?: number
  delayMs?: number
}

/** Write the preset into the AxiStream profile's Simple output settings.
 *  Takes effect at the next StartStream. Best-effort: returns false on
 *  failure and never throws — go-live proceeds on whatever the profile holds. */
export async function applyEncoderSettings(deps: ApplyEncoderDeps, preset: EncoderPreset): Promise<boolean> {
  const ready = <T>(fn: () => Promise<T>) => callReady(fn, { tries: deps.tries, delayMs: deps.delayMs })
  const set = (parameterCategory: string, parameterName: string, parameterValue: string) =>
    ready(() => deps.call('SetProfileParameter', { parameterCategory, parameterName, parameterValue }))
  try {
    await set('Output', 'Mode', 'Simple')
    await set('SimpleOutput', 'StreamEncoder', preset.streamEncoder)
    await set('SimpleOutput', 'VBitrate', String(preset.videoBitrateKbps))
    await set('SimpleOutput', 'ABitrate', String(preset.audioBitrateKbps))
    return true
  } catch {
    return false
  }
}
