export const PLUGIN_REF = 'com.obsproject.Studio.Plugin.PipeWireAudioCapture'

export type FlatpakState = 'missing' | 'installed' | 'unsupported'
// Temporary home; Task 2 moves this to shared/state.ts and this file re-imports it.
export type GameAudioPluginStatus = 'missing' | 'installing' | 'installed' | 'ready' | 'error' | 'unsupported'

export interface ExecResult { code: number; output: string }
export interface InstallerDeps {
  exec(cmd: string, args: string[], timeoutMs: number): Promise<ExecResult>
}

const DETECT_TIMEOUT_MS = 15000
const INSTALL_TIMEOUT_MS = 600000

/** Detects and installs the OBS PipeWire audio-capture flatpak extension.
 *  User-level install first (no password; flatpak resolves extensions across
 *  installations), one system-level retry (polkit dialog). Best-effort:
 *  install() never rejects. */
export class PluginInstaller {
  constructor(private readonly d: InstallerDeps) {}

  async detectInstalled(): Promise<FlatpakState> {
    try {
      const r = await this.d.exec('flatpak', ['info', PLUGIN_REF], DETECT_TIMEOUT_MS)
      return r.code === 0 ? 'installed' : 'missing'
    } catch {
      return 'unsupported' // flatpak binary missing / unspawnable
    }
  }

  async install(): Promise<{ ok: boolean; error?: string }> {
    let last = ''
    for (const scope of ['--user', '--system']) {
      try {
        const r = await this.d.exec('flatpak', ['install', scope, '--noninteractive', 'flathub', PLUGIN_REF], INSTALL_TIMEOUT_MS)
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
