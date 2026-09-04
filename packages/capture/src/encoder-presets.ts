import { encoderAvailability, encoderEntry, type EncoderId, type ResolvedEncoderId, type Vendor } from './encoder-entries.js'

export interface EncoderPreset {
  streamEncoder: string    // SimpleOutput/StreamEncoder ini value
  videoBitrateKbps: number
  audioBitrateKbps: number
  label: string            // shown in the stats chip
}

/** User overrides layered over the auto-detected preset. `null`/absent = auto. */
export interface QualityOverrides {
  videoBitrateKbps?: number | null
}

/** The complete set of SimpleOutput/StreamEncoder values OBS recognizes —
 *  get_simple_output_encoder(), frontend/utility/SimpleOutput.cpp:88 in
 *  obs-studio 32.1.2. Anything else silently resolves to obs_x264, which is
 *  how the VAAPI preset shipped software encoding under a "VAAPI" label. */
export const OBS_SIMPLE_ENCODERS = [
  'x264', 'x264_lowcpu', 'qsv', 'qsv_av1', 'nvenc', 'nvenc_av1', 'nvenc_hevc',
  'amd', 'amd_hevc', 'amd_av1', 'apple_h264', 'apple_hevc',
] as const

/** YouTube-recommended upper range — GW2 is high-motion. "High fps" = ≥ 50. */
function videoBitrate(outputHeight: number, fps: number): number {
  const high = fps >= 50
  if (outputHeight >= 1440) return high ? 24000 : 13000
  if (outputHeight >= 1080) return high ? 9000 : 6000
  if (outputHeight >= 720) return high ? 6000 : 4000
  return 2500
}

/** Short labels for the stat chip — the picker's own labels are too long for
 *  a chip, and the chip's job is "what is actually encoding right now". */
const CHIP_LABELS: Record<ResolvedEncoderId, string> = {
  x264: 'x264',
  nvenc_h264: 'NVENC H.264',
  nvenc_hevc: 'NVENC HEVC',
  nvenc_av1: 'NVENC AV1',
  amd_h264: 'AMD H.264',
  amd_hevc: 'AMD HEVC',
  vaapi_h264: 'VAAPI H.264',
}

/** The short "what is actually encoding" name for a resolved encoder. Exported
 *  so the renderer can label the Auto row with what auto would really resolve
 *  to, instead of echoing whatever preset happens to be applied right now. */
export function chipLabel(id: ResolvedEncoderId): string {
  return CHIP_LABELS[id]
}

/** The user's selection -> what will actually be written to OBS. 'auto', and
 *  any selection that is no longer available (the GPU changed, or the row was
 *  always ingest-gated), resolves to the best available encoder rather than
 *  failing go-live. */
export function resolveEncoder(id: EncoderId, vendor: Vendor, platform: NodeJS.Platform): ResolvedEncoderId {
  if (id !== 'auto' && encoderAvailability(encoderEntry(id), vendor, platform) === 'ok') return id
  // Auto-selection deliberately only promotes NVENC today: detectVendor()
  // never reports 'amd-intel' on a platform where the AMD rows are usable
  // (it only sees 'amd-intel' on Linux, where amd_h264/amd_hevc are always
  // amf-windows-only). When Windows vendor detection lands (an explicit
  // follow-up), this branch needs extending to promote amd_h264 there too,
  // or 'auto' will silently keep picking x264 on AMD Windows boxes.
  //
  // That same follow-up MUST first split Vendor's 'amd-intel' bucket into
  // separate 'amd' and 'intel' values. encoderAvailability gates the AMF rows
  // (amd_h264/amd_hevc) on vendor === 'amd-intel', and AMF is AMD-only — so an
  // Intel GPU reporting 'amd-intel' on Windows would light up "Hardware (AMD,
  // H.264)" for hardware that cannot drive it. Harmless today only because
  // nothing reports 'amd-intel' on win32 yet.
  if (vendor === 'nvidia' && encoderAvailability(encoderEntry('nvenc_h264'), vendor, platform) === 'ok') return 'nvenc_h264'
  return 'x264'
}

export function presetFor(
  id: ResolvedEncoderId, outputHeight: number, fps: number, overrides?: QualityOverrides,
): EncoderPreset {
  const entry = encoderEntry(id)
  // resolveEncoder only ever returns ids with a real OBS string, so the null
  // case (VAAPI) is unreachable here — fall back rather than throw, because
  // nothing encoder-side may block go-live. The label follows the same
  // substitution so the chip can never claim an encoder that is not
  // actually running (a caller could still reach this by calling presetFor
  // directly with 'vaapi_h264', bypassing resolveEncoder).
  const streamEncoder = entry.streamEncoder ?? 'x264'
  const label = entry.streamEncoder === null ? CHIP_LABELS.x264 : CHIP_LABELS[id]
  return {
    streamEncoder,
    label,
    videoBitrateKbps: overrides?.videoBitrateKbps ?? videoBitrate(outputHeight, fps),
    audioBitrateKbps: 160,
  }
}
