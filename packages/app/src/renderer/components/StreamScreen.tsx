import type { AppState } from '../../shared/state.js'
import type { AxiApi } from '../../shared/state.js'
import { StatChips } from './StatChips.js'
import { KeyInput } from './KeyInput.js'

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000); const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function StreamScreen({ state, preview, axi }: { state: AppState; preview: string | null; axi: AxiApi }) {
  const { phase, capture, keyMasked, stats } = state
  const live = phase === 'LIVE' || phase === 'RECONNECTING'

  if (phase === 'SETTING_UP') {
    return (
      <div className="hero setup">
        <div className="setup-icon">▦</div>
        <h2>Set up your capture</h2>
        <p>AxiStream will ask you to pick the screen showing your game. You'll only do this once.</p>
        <button className="btn primary lg" onClick={() => axi.provision()}>Set up capture →</button>
      </div>
    )
  }

  return (
    <div className="hero" style={preview ? { backgroundImage: `url(${preview})` } : undefined}>
      <div className="hero-top">
        <span className="hero-title">Stream</span>
        {live ? <span className="badge live"><span aria-hidden>● </span>LIVE</span> : <span className="badge">● PREVIEW</span>}
        {live && stats ? <span className="pill mono">{fmt(stats.durationMs)}</span> : null}
        {capture ? <span className="pill mono">{`${capture.sourceLabel} · ${capture.width}×${capture.height} · ${capture.fps}fps`}</span> : null}
      </div>

      {phase === 'AWAITING_APPROVAL' ? (
        <div className="overlay">Approve the screen-share dialog to finish setup…</div>
      ) : null}
      {phase === 'ERROR' && state.error ? <div className="overlay error">{state.error}</div> : null}
      {phase === 'RECONNECTING' ? <div className="overlay warn">Reconnecting…</div> : null}

      <div className="hero-bottom">
        <div className="statusrow">
          <span className="dot good" /> Capture {capture ? 'ready' : '…'}
          {keyMasked ? <span className="pill mono">🔑 {keyMasked} <button className="link" onClick={() => axi.forgetKey()}>Forget</button></span> : null}
          <span className="spacer" />
          <StatChips stats={stats} />
        </div>

        {phase === 'NEEDS_KEY' ? (
          <KeyInput onSave={(k) => axi.saveKey(k)} />
        ) : live ? (
          <button className="btn danger lg" onClick={() => axi.stopStream()}>■ End Stream</button>
        ) : (
          <button className="btn primary lg" disabled={phase === 'GOING_LIVE'} onClick={() => axi.goLive()}>
            {phase === 'GOING_LIVE' ? 'Starting…' : '● Go Live'}
          </button>
        )}
      </div>
    </div>
  )
}
