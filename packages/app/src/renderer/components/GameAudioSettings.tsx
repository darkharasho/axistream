import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { AxiApi, AppState, StreamPhase, AudioDevice } from '../../shared/state.js'
import { staleOption } from '../device-options.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi
const LIVE_PHASES: StreamPhase[] = ['GOING_LIVE', 'LIVE', 'RECONNECTING']

export function GameAudioSettings({ plugin, phase, audio }: { plugin: AppState['gameAudioPlugin']; phase: StreamPhase; audio: AppState['audio'] }) {
  const { status, error } = plugin
  const [apps, setApps] = useState<AudioDevice[] | null>(null)
  useEffect(() => {
    if (status !== 'ready' || !audio.gameAudioEnabled) return
    axi().getGameAudioApps().then(setApps)
  }, [status, audio.gameAudioEnabled])
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
      {status === 'ready' && (
        <>
          <label className="audio-row">
            <input type="checkbox" checked={audio.gameAudioEnabled} aria-label="Game audio"
              onChange={(e) => axi().setGameAudioEnabled(e.target.checked)} />
            <span>Game audio</span>
          </label>
          {audio.gameAudioEnabled && (() => {
            const stale = apps ? staleOption(audio.gameAudioTarget, apps, 'Saved app (not running)') : null
            return (
              <label>Application
                <select value={audio.gameAudioTarget ?? ''} onChange={(e) => axi().setGameAudioTarget(e.target.value)}>
                  {stale && <option value={stale.id}>{stale.name}</option>}
                  {!audio.gameAudioTarget && !stale && <option value="">Choose an application…</option>}
                  {apps?.length === 0 && !stale && <option value="">No apps playing audio</option>}
                  {(apps ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            )
          })()}
          <p className="muted">Pick Guild Wars 2 while it's running. Desktop audio turns off automatically — game audio replaces it.</p>
        </>
      )}
      {status === 'error' && (
        <>
          <p className="muted mono">{error}</p>
          <button className="btn ghost" onClick={() => axi().installGameAudioPlugin()}>Retry install</button>
        </>
      )}
    </section>
  )
}
