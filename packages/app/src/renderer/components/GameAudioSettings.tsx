import { Loader2 } from 'lucide-react'
import type { AxiApi, AppState, StreamPhase } from '../../shared/state.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi
const LIVE_PHASES: StreamPhase[] = ['GOING_LIVE', 'LIVE', 'RECONNECTING']

export function GameAudioSettings({ plugin, phase }: { plugin: AppState['gameAudioPlugin']; phase: StreamPhase }) {
  const { status, error } = plugin
  if (status === 'ready') return null
  return (
    <section className="yt-settings">
      <h3>Game audio</h3>
      {status === 'unsupported' && <p className="axi-ink-dim">Per-app game audio requires the OBS flatpak.</p>}
      {status === 'missing' && (
        <>
          <p className="axi-ink-dim">Capture only your game's audio — needs a free OBS plugin.</p>
          <button className="axi-btn axi-btn--ghost" onClick={() => axi().installGameAudioPlugin()}>Install plugin</button>
        </>
      )}
      {status === 'installing' && (
        <button className="axi-btn axi-btn--ghost" disabled><Loader2 size={12} className="spin" /> Installing…</button>
      )}
      {status === 'installed' && (
        <>
          <p className="axi-ink-dim">Installed — restart AxiStream to activate.</p>
          {LIVE_PHASES.includes(phase) ? null : (
            <button className="axi-btn axi-btn--ghost" onClick={() => axi().relaunchApp()}>Restart AxiStream</button>
          )}
        </>
      )}
      {status === 'error' && (
        <>
          <p className="axi-ink-dim mono">{error}</p>
          <button className="axi-btn axi-btn--ghost" onClick={() => axi().installGameAudioPlugin()}>Retry install</button>
        </>
      )}
    </section>
  )
}
