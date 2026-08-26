import type { QualityOverrides } from '@axistream/capture'
import { AUTO_MAX_HEIGHT, AUTO_FPS, type QualityView } from '../shared/state.js'
import type { StreamSettingsData } from './StreamSettings.js'

export interface QualityApplyArgs {
  maxHeight: number
  fps: number
  overrides: QualityOverrides
}

/** Settings -> the arguments applyCaptureResolution and choosePreset need. */
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
    preferSoftware: s.preferSoftware,
    preferSoftwareAuto: s.preferSoftwareAuto,
  }
}
