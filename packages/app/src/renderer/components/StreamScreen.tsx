import { MonitorPlay, Key, Radio, Square, RefreshCw, Loader2 } from 'lucide-react'
import type { AppState } from '../../shared/state.js'
import type { AxiApi } from '../../shared/state.js'
import type { Store } from '../../renderer/store.js'
import { StatChips } from './StatChips.js'
import { KeyInput } from './KeyInput.js'
import { PreviewVideo } from './PreviewVideo.js'
import { TitlePromptModal } from './TitlePromptModal.js'

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000); const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function StreamScreen({ state, preview, axi, store }: { state: AppState; preview: string | null; axi: AxiApi; store: Store }) {
  const { phase, capture, keyMasked, stats } = state
  const live = phase === 'LIVE' || phase === 'RECONNECTING'

  if (phase === 'SETTING_UP') {
    return (
      <div className="hero setup">
        <div className="setup-icon"><MonitorPlay size={26} /></div>
        <h2>Set up your capture</h2>
        <p>AxiStream will ask you to pick the screen showing your game. You'll only do this once.</p>
        <button className="btn primary lg" onClick={() => axi.provision()}>Set up capture →</button>
      </div>
    )
  }

  return (
    <div className="hero">
      <PreviewVideo />
      <div className="hero-top">
        <span className="hero-title">Stream</span>
        {live ? <span className="badge live"><span aria-hidden>● </span>LIVE</span> : <span className="badge">● PREVIEW</span>}
        {live && stats ? <span className="pill mono">{fmt(stats.durationMs)}</span> : null}
        {capture ? <span className="pill mono">{`${capture.sourceLabel} · ${capture.width}×${capture.height} · ${capture.fps}fps`}</span> : null}
      </div>

      {phase === 'AWAITING_APPROVAL' ? (
        <div className="overlay"><span className="overlay-pill">Approve the screen-share dialog to finish setup…</span></div>
      ) : null}
      {phase === 'ERROR' && state.error ? <div className="overlay error"><span className="overlay-pill">{state.error}</span></div> : null}
      {phase === 'RECONNECTING' ? <div className="overlay warn"><span className="overlay-pill">Reconnecting…</span></div> : null}
      {phase === 'NEEDS_TITLE' ? (
        <TitlePromptModal onClose={() => axi.getInitialState().then((s) => store.applyState(s))} />
      ) : null}

      <div className="hero-bottom">
        <div className="statusrow">
          <span className="dot good" /> Capture {capture ? 'ready' : '…'}
          {live || phase === 'GOING_LIVE' ? null
            : phase === 'AWAITING_APPROVAL'
            ? <button className="btn ghost xs" disabled><Loader2 size={12} className="spin" /> Switching…</button>
            : <button className="btn ghost xs" onClick={() => axi.switchSource()} title="Pick a different screen or window"><RefreshCw size={12} /> Switch source</button>}
          {keyMasked ? <span className="pill mono"><Key size={12} /> {keyMasked} <button className="link" onClick={() => axi.forgetKey()}>Forget</button></span> : null}
          <span className="spacer" />
          <StatChips stats={stats} capture={capture} />
        </div>

        {phase === 'NEEDS_KEY' ? (
          <KeyInput onSave={(k) => axi.saveKey(k)} />
        ) : live ? (
          <button className="btn danger action" onClick={() => axi.stopStream()}><Square size={16} /> End Stream</button>
        ) : (
          <button className="btn primary action" disabled={phase === 'GOING_LIVE'} onClick={() => axi.goLive()}>
            {phase === 'GOING_LIVE' ? 'Starting…' : <><Radio size={15} /> Go Live</>}
          </button>
        )}
      </div>
    </div>
  )
}
