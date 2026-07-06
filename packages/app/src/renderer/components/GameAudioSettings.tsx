import { Loader2 } from 'lucide-react'
import type { AxiApi, AppState, StreamPhase } from '../../shared/state.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi
const LIVE_PHASES: StreamPhase[] = ['GOING_LIVE', 'LIVE', 'RECONNECTING']

export function GameAudioSettings({ plugin, phase }: { plugin: AppState['gameAudioPlugin']; phase: StreamPhase }) {
  const { status, error } = plugin
  return (
    <section className="yt-settings">
      <h3>Game audio</h3>
      {status === 'unsupported' && <p className="muted">Per-app game audio requires the OBS flatpak.</p>}
      {status === 'missing' && (
        <>
          <p className="muted">Capture only your game's audio — needs a free OBS plugin.</p>
          <button className="btn ghost" onClick={() => axi().installGameAudioPlugin()}>Install plugin</button>
        </>
      )}
      {status === 'installing' && (
        <button className="btn ghost" disabled><Loader2 size={12} className="spin" /> Installing…</button>
      )}
      {status === 'installed' && (
        <>
          <p className="muted">Installed — restart AxiStream to activate.</p>
          {LIVE_PHASES.includes(phase) ? null : (
            <button className="btn ghost" onClick={() => axi().relaunchApp()}>Restart AxiStream</button>
          )}
        </>
      )}
      {status === 'ready' && <p className="ok">Ready ✓</p>}
      {status === 'error' && (
        <>
          <p className="muted mono">{error}</p>
          <button className="btn ghost" onClick={() => axi().installGameAudioPlugin()}>Retry install</button>
        </>
      )}
    </section>
  )
}
