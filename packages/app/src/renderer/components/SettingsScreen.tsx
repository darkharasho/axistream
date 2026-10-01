import type { AppState, AxiApi } from '../../shared/state.js'
import { AppearanceSettings } from './AppearanceSettings.js'
import { YouTubeSettings } from './YouTubeSettings.js'
import { AudioSettings } from './AudioSettings.js'
import { HotkeySettings } from './HotkeySettings.js'
import { UpdatesSettings } from './UpdatesSettings.js'
import { DiagnosticsSettings } from './DiagnosticsSettings.js'
import { RecordingSettings } from './RecordingSettings.js'
import { WebcamSettings } from './WebcamSettings.js'
import { QualitySettings } from './QualitySettings.js'
import { AboutSettings } from './AboutSettings.js'

export function SettingsScreen({ state, axi, onRunSetup }: { state: AppState; axi: AxiApi; onRunSetup: () => void }) {
  return (
    <div className="hero settings-panel">
      <div className="settings-inner axi-page">
        <h2>Settings</h2>
        <div className="settings-grid">

          <section className="axi-panel">
            <AppearanceSettings />
          </section>

          <section className="axi-panel">
            <YouTubeSettings youtube={state.youtube} />
          </section>

          <section className="axi-panel">
            <AudioSettings audio={state.audio} gameAudioPlugin={state.gameAudioPlugin} phase={state.phase} ptt={state.ptt} />
          </section>

          <section className="axi-panel">
            <HotkeySettings hotkeys={state.hotkeys} axi={axi} />
          </section>

          <section className="axi-panel">
            <WebcamSettings webcam={state.webcam} axi={axi} />
          </section>

          <section className="axi-panel">
            <QualitySettings state={state} axi={axi} />
          </section>

          <section className="axi-panel">
            <RecordingSettings recording={state.recording} axi={axi} />
          </section>

          <section className="axi-panel">
            <h3>Capture</h3>
            <p className="axi-ink-dim">Re-run setup if you changed monitors or the capture stopped working.</p>
            <button className="axi-btn axi-btn--ghost" onClick={() => axi.repairCapture()}>Re-set up capture</button>
          </section>

          <section className="axi-panel">
            <DiagnosticsSettings axi={axi} />
          </section>

          {/* Updates & What's New sit last: they are the least-used controls
              and the What's New body is the tallest block in the panel. */}
          <section className="axi-panel">
            <UpdatesSettings />
          </section>

          <AboutSettings onRunSetup={onRunSetup} />
        </div>
      </div>
    </div>
  )
}
