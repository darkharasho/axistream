import type { QualityOverrides } from '@axistream/capture'
import { AUTO_MAX_HEIGHT, AUTO_FPS, type QualityPatch, type QualityView } from '../shared/state.js'
import type { StreamSettingsData } from './StreamSettings.js'

export interface QualityApplyArgs {
  maxHeight: number
  fps: number
  overrides: QualityOverrides
}

/** Settings -> the arguments applyCaptureResolution and presetFor need. */
export function qualityOf(s: StreamSettingsData): QualityApplyArgs {
  return {
    maxHeight: s.qualityHeight ?? AUTO_MAX_HEIGHT,
    fps: s.qualityFps ?? AUTO_FPS,
    overrides: { videoBitrateKbps: s.qualityBitrateKbps },
  }
}

/** Settings -> the slice the renderer's Quality panel reads. */
export function qualityViewOf(s: StreamSettingsData): QualityView {
  return {
    height: s.qualityHeight,
    fps: s.qualityFps,
    bitrateKbps: s.qualityBitrateKbps,
    encoder: s.encoder,
    encoderAuto: s.encoderAuto,
  }
}

/** A renderer patch -> the settings fields it writes. Key *presence* decides
 *  what is touched: an absent key is left alone, a key present as null clears
 *  that field back to auto. */
export function qualityPatchOf(p: QualityPatch): Partial<StreamSettingsData> {
  const patch: Partial<StreamSettingsData> = {}
  if ('height' in p) patch.qualityHeight = p.height ?? null
  if ('fps' in p) patch.qualityFps = p.fps ?? null
  if ('bitrateKbps' in p) patch.qualityBitrateKbps = p.bitrateKbps ?? null
  // A user touching the picker takes ownership of the choice, so the
  // "AxiStream switched this for you" explanation stops applying.
  if ('encoder' in p && p.encoder) { patch.encoder = p.encoder; patch.encoderAuto = false }
  return patch
}
