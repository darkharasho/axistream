import type { AppState, AxiApi } from '../../shared/state.js'
import { KeyInput } from './KeyInput.js'

export function SettingsScreen({ state, axi }: { state: AppState; axi: AxiApi }) {
  return (
    <div className="hero settings-panel">
      <div className="settings-inner">
        <h2>Settings</h2>

        <section className="setting">
          <h3>YouTube stream key</h3>
          {state.keyMasked ? (
            <div className="keyrow saved">
              <span className="pill mono">🔑 {state.keyMasked}</span>
              <button className="btn ghost" onClick={() => axi.forgetKey()}>Forget</button>
            </div>
          ) : (
            <KeyInput onSave={(k) => axi.saveKey(k)} />
          )}
        </section>

        <section className="setting">
          <h3>Capture</h3>
          <p className="muted">Re-run setup if you changed monitors or the capture stopped working.</p>
          <button className="btn ghost" onClick={() => axi.repairCapture()}>Re-set up capture</button>
        </section>
      </div>
    </div>
  )
}
