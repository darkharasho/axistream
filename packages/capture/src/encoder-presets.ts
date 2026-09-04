import { encoderAvailability, encoderEntry, type EncoderId, type ResolvedEncoderId, type Vendor } from './encoder-entries.js'

export type EncoderKind = 'nvenc' | 'vaapi' | 'x264'

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

const ENCODERS: Record<EncoderKind, { streamEncoder: string; label: string }> = {
  nvenc: { streamEncoder: 'nvenc', label: 'NVENC' },
  // A DRI render node means AMD/Intel hardware is present, but OBS's *Simple*
  // output mode has no VAAPI mapping — 'ffmpeg_vaapi' is not one of the twelve
  // strings get_simple_output_encoder() knows, so OBS silently ran obs_x264
  // while the stat chip read "VAAPI". Tell the truth instead. Real VAAPI needs
  // Advanced output mode (and writing streamEncoder.json, which
  // SetProfileParameter cannot reach) — see the follow-up in
  // docs/superpowers/specs/2026-09-03-encoder-codec-picker-design.md.
  vaapi: { streamEncoder: 'x264', label: 'x264' },
  x264: { streamEncoder: 'x264', label: 'x264' },
}

/** YouTube-recommended upper range — GW2 is high-motion. "High fps" = ≥ 50. */
function videoBitrate(outputHeight: number, fps: number): number {
  const high = fps >= 50
  if (outputHeight >= 1440) return high ? 24000 : 13000
  if (outputHeight >= 1080) return high ? 9000 : 6000
  if (outputHeight >= 720) return high ? 6000 : 4000
  return 2500
}

export function choosePreset(
  kind: EncoderKind, outputHeight: number, fps: number, overrides?: QualityOverrides,
): EncoderPreset {
  const e = ENCODERS[kind]
  return {
    ...e,
    videoBitrateKbps: overrides?.videoBitrateKbps ?? videoBitrate(outputHeight, fps),
    audioBitrateKbps: 160,
  }
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

/** The user's selection -> what will actually be written to OBS. 'auto', and
 *  any selection that is no longer available (the GPU changed, or the row was
 *  always ingest-gated), resolves to the best available encoder rather than
 *  failing go-live. */
export function resolveEncoder(id: EncoderId, vendor: Vendor, platform: NodeJS.Platform): ResolvedEncoderId {
  if (id !== 'auto' && encoderAvailability(encoderEntry(id), vendor, platform) === 'ok') return id
  if (vendor === 'nvidia' && encoderAvailability(encoderEntry('nvenc_h264'), vendor, platform) === 'ok') return 'nvenc_h264'
  return 'x264'
}

export function presetFor(
  id: ResolvedEncoderId, outputHeight: number, fps: number, overrides?: QualityOverrides,
): EncoderPreset {
  const entry = encoderEntry(id)
  return {
    // resolveEncoder only ever returns ids with a real OBS string, so the
    // null case (VAAPI) is unreachable here — fall back rather than throw,
    // because nothing encoder-side may block go-live.
    streamEncoder: entry.streamEncoder ?? 'x264',
    label: CHIP_LABELS[id],
    videoBitrateKbps: overrides?.videoBitrateKbps ?? videoBitrate(outputHeight, fps),
    audioBitrateKbps: 160,
  }
}
