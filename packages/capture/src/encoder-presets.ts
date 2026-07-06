export type EncoderKind = 'nvenc' | 'vaapi' | 'x264'

export interface EncoderPreset {
  streamEncoder: string    // SimpleOutput/StreamEncoder ini value
  videoBitrateKbps: number
  audioBitrateKbps: number
  label: string            // shown in the stats chip
}

const ENCODERS: Record<EncoderKind, { streamEncoder: string; label: string }> = {
  nvenc: { streamEncoder: 'nvenc', label: 'NVENC' },
  vaapi: { streamEncoder: 'ffmpeg_vaapi', label: 'VAAPI' },
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

export function choosePreset(kind: EncoderKind, outputHeight: number, fps: number): EncoderPreset {
  const e = ENCODERS[kind]
  return { ...e, videoBitrateKbps: videoBitrate(outputHeight, fps), audioBitrateKbps: 160 }
}
