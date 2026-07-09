import type { AppState, AxiApi } from '../../shared/state.js'
import { YouTubeSettings } from './YouTubeSettings.js'
import { AudioSettings } from './AudioSettings.js'
import { UpdatesSettings } from './UpdatesSettings.js'

export function SettingsScreen({ state, axi }: { state: AppState; axi: AxiApi }) {
  return (
    <div className="hero settings-panel">
      <div className="settings-inner">
        <h2>Settings</h2>
        <div className="settings-grid">

          <section className="setting">
            <YouTubeSettings youtube={state.youtube} />
          </section>

          <section className="setting">
            <AudioSettings audio={state.audio} gameAudioPlugin={state.gameAudioPlugin} phase={state.phase} ptt={state.ptt} />
          </section>

          <section className="setting">
            <UpdatesSettings />
          </section>

          <section className="setting">
            <h3>Quality</h3>
            <p className="muted">
              {state.encoder}
              {state.videoBitrateKbps ? ` · ${state.videoBitrateKbps / 1000} Mbps` : ''}
              {state.capture ? ` — chosen automatically for ${state.capture.outputHeight}p${state.capture.fps}` : ' — chosen automatically'}
            </p>
          </section>

          <section className="setting">
            <h3>Capture</h3>
            <p className="muted">Re-run setup if you changed monitors or the capture stopped working.</p>
            <button className="btn ghost" onClick={() => axi.repairCapture()}>Re-set up capture</button>
          </section>
        </div>
      </div>
    </div>
  )
}
