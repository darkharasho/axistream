import { homedir } from 'node:os'
import type { AppState } from '../shared/state.js'

const PATTERNS: Array<[RegExp, string]> = [
  [/https:\/\/discord(?:app)?\.com\/api\/webhooks\/\S+/gi, 'https://discord.com/api/webhooks/<redacted>'],
  [/Bearer\s+[\w.\-]+/gi, 'Bearer <redacted>'],
  [/\b(stream_key|key)=[^&\s]+/gi, '$1=<redacted>'],
  [/\b[a-z0-9]{4}(?:-[a-z0-9]{4}){4}\b/gi, '<redacted-stream-key>'],
]

/**
 * Write-time denylist for free-text log lines.
 *
 * `home` is a literal string replacement rather than a regex, so a path
 * containing regex metacharacters cannot defeat it. It is a parameter only so
 * tests can exercise that case.
 */
export function scrubLine(s: string, home: string = homedir()): string {
  let out = s
  for (const [re, to] of PATTERNS) out = out.replace(re, to)
  if (home) out = out.split(home).join('~')
  return out
}

/**
 * Field allowlist for the structured state dump.
 *
 * Deliberately an allowlist, not a denylist: a field added to AppState by a
 * later sub-project must not silently begin shipping in diagnostics bundles.
 */
export function pickState(state: AppState): Record<string, unknown> {
  return {
    phase: state.phase,
    encoder: state.encoder,
    videoBitrateKbps: state.videoBitrateKbps,
    capture: state.capture,
    stats: state.stats,
    liveUnconfirmed: state.liveUnconfirmed,
    error: state.error,
    audio: state.audio,
    masks: state.masks.map((m) => ({ x: m.x, y: m.y, w: m.w, h: m.h })),
    maskStyle: state.maskStyle,
    masksVisible: state.masksVisible,
    gameAudioPlugin: state.gameAudioPlugin,
    blurPlugin: state.blurPlugin,
    ptt: state.ptt,
    windowFitted: state.windowFitted,
    youtube: { connected: state.youtube.connected },
    settings: {
      titleTemplate: state.settings.titleTemplate,
      dateFormat: state.settings.dateFormat,
      privacy: state.settings.privacy,
    },
  }
}
