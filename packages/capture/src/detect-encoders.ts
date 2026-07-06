import type { EncoderKind } from './encoder-presets.js'

export interface DetectDeps {
  platform: NodeJS.Platform
  existsSync(p: string): boolean
  readdirSync(p: string): string[]
}

/** Cheap hardware hint — OBS's own encoder-availability check is the
 *  authority (an unavailable SimpleOutput encoder falls back to x264 inside
 *  OBS), so a false positive costs nothing worse than that fallback. */
export function detectEncoder(d: DetectDeps): EncoderKind {
  if (d.platform !== 'linux') return 'x264'
  if (d.existsSync('/dev/nvidiactl') || d.existsSync('/dev/nvidia0')) return 'nvenc'
  try {
    if (d.readdirSync('/dev/dri').some((n) => n.startsWith('renderD'))) return 'vaapi'
  } catch { /* no DRI access */ }
  return 'x264'
}
