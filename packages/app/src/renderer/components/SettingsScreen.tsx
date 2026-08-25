import type { AppState, AxiApi } from '../../shared/state.js'
import { YouTubeSettings } from './YouTubeSettings.js'
import { AudioSettings } from './AudioSettings.js'
import { UpdatesSettings } from './UpdatesSettings.js'
import { DiagnosticsSettings } from './DiagnosticsSettings.js'
import { RecordingSettings } from './RecordingSettings.js'
import { WebcamSettings } from './WebcamSettings.js'

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
            <WebcamSettings webcam={state.webcam} axi={axi} />
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
            <RecordingSettings recording={state.recording} axi={axi} />
          </section>

          <section className="setting">
            <h3>Capture</h3>
            <p className="muted">Re-run setup if you changed monitors or the capture stopped working.</p>
            <button className="btn ghost" onClick={() => axi.repairCapture()}>Re-set up capture</button>
          </section>

          <section className="setting">
            <DiagnosticsSettings axi={axi} />
          </section>

          {/* Updates & What's New sit last: they are the least-used controls
              and the What's New body is the tallest block in the panel. */}
          <section className="setting">
            <UpdatesSettings />
          </section>
        </div>
      </div>
    </div>
  )
}
