import type { Vendor } from './encoder-entries.js'

export interface DetectDeps {
  platform: NodeJS.Platform
  existsSync(p: string): boolean
  readdirSync(p: string): string[]
}

/** Which GPU vendor the picker should treat as present. A cheap hardware
 *  hint — OBS's own encoder-availability check is the authority (an
 *  unavailable SimpleOutput encoder falls back to x264 inside OBS), so a
 *  false positive costs nothing worse than that fallback. */
export function detectVendor(d: DetectDeps): Vendor {
  if (d.platform !== 'linux') return 'none'
  if (d.existsSync('/dev/nvidiactl') || d.existsSync('/dev/nvidia0')) return 'nvidia'
  try {
    if (d.readdirSync('/dev/dri').some((n) => n.startsWith('renderD'))) return 'amd-intel'
  } catch { /* no DRI access */ }
  return 'none'
}
