import type { GameAudioPluginStatus } from '../shared/state.js'

export const GAME_AUDIO_PLUGIN_REF = 'bundled:pipewire-audio-capture'
export const BLUR_PLUGIN_REF = 'bundled:composite-blur'

export type { GameAudioPluginStatus }
export type FlatpakState = 'missing' | 'installed' | 'unsupported'

export interface ExecResult { code: number; output: string }
export interface InstallerDeps {
  exec(cmd: string, args: string[], timeoutMs: number): Promise<ExecResult>
  ref: string
}

const DETECT_TIMEOUT_MS = 15000
const INSTALL_TIMEOUT_MS = 600000

/** Bundled plugin refs are already part of the verified owned runtime and must
 * never cause a Flatpak extension operation. Generic refs retain the legacy
 * installer behavior for compatibility and tests. install() never rejects. */
export class PluginInstaller {
  constructor(private readonly d: InstallerDeps) {}

  async detectInstalled(): Promise<FlatpakState> {
    if (this.d.ref.startsWith('bundled:')) return 'installed'
    try {
      const r = await this.d.exec('flatpak', ['info', this.d.ref], DETECT_TIMEOUT_MS)
      return r.code === 0 ? 'installed' : 'missing'
    } catch {
      return 'unsupported' // flatpak binary missing / unspawnable
    }
  }

  async install(): Promise<{ ok: boolean; error?: string }> {
    if (this.d.ref.startsWith('bundled:')) return { ok: true }
    let last = ''
    for (const scope of ['--user', '--system']) {
      try {
        const r = await this.d.exec('flatpak', ['install', scope, '--noninteractive', 'flathub', this.d.ref], INSTALL_TIMEOUT_MS)
        if (r.code === 0) return { ok: true }
        last = r.output
      } catch (e) {
        last = e instanceof Error ? e.message : String(e)
      }
    }
    return { ok: false, error: last.slice(-500) }
  }
}

/** Combined status: flatpak state (on disk) + OBS input kinds (loaded).
 *  The built-in screen-capture kind must not count as the audio plugin. */
export function deriveGameAudioStatus(flatpak: FlatpakState, kinds: string[]): GameAudioPluginStatus {
  if (flatpak === 'unsupported') return 'unsupported'
  if (flatpak === 'missing') return 'missing'
  const loaded = kinds.some((k) => k !== 'pipewire-screen-capture-source' && /pipewire.*audio|audio.*pipewire/i.test(k))
  return loaded ? 'ready' : 'installed'
}

/** Blur-plugin readiness: the CompositeBlur filter kind is an exact id —
 *  no regex needed (unlike the audio plugin's several kinds). */
export function deriveBlurStatus(flatpak: FlatpakState, filterKinds: string[]): GameAudioPluginStatus {
  if (flatpak === 'unsupported') return 'unsupported'
  if (flatpak === 'missing') return 'missing'
  return filterKinds.includes('obs_composite_blur') ? 'ready' : 'installed'
}
