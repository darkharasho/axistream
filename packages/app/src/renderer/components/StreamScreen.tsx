import { useState } from 'react'
import { MonitorPlay, Radio, Square, RefreshCw, Loader2, Shield, Scan, Link, Check } from 'lucide-react'
import type { AppState } from '../../shared/state.js'
import type { AxiApi } from '../../shared/state.js'
import type { Store } from '../../renderer/store.js'
import { StatChips } from './StatChips.js'
import { PreviewVideo } from './PreviewVideo.js'
import { TitlePromptModal } from './TitlePromptModal.js'
import { MaskEditor } from './MaskEditor.js'
import { LiveBadge } from './LiveBadge.js'

export function StreamScreen({ state, preview, axi, store }: { state: AppState; preview: string | null; axi: AxiApi; store: Store }) {
  const { phase, capture, stats } = state
  const live = phase === 'LIVE' || phase === 'RECONNECTING'
  const [editingMasks, setEditingMasks] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyLink = () => {
    if (!state.watchUrl) return
    navigator.clipboard.writeText(state.watchUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

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
        <LiveBadge phase={phase} liveUnconfirmed={state.liveUnconfirmed} durationMs={stats?.durationMs ?? 0} />
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
      {editingMasks ? (
        <MaskEditor masks={state.masks} maskStyle={state.maskStyle} blurPlugin={state.blurPlugin}
          masksVisible={state.masksVisible} onSetVisible={(v) => axi.setMasksVisible(v)}
          onSetStyle={(s) => axi.setMaskStyle(s)} onInstallBlur={() => axi.installBlurPlugin()}
          onRelaunch={() => axi.relaunchApp()}
          onCommit={(m) => axi.setMasks(m)} onDone={() => setEditingMasks(false)} />
      ) : null}

      <div className="hero-bottom">
        <div className="statusrow">
          <span className="dot good" /> Capture {capture ? 'ready' : '…'}
          {live || phase === 'GOING_LIVE' || phase === 'STARTING_ON_YOUTUBE' ? null
            : phase === 'AWAITING_APPROVAL'
            ? <button className="btn ghost xs" disabled><Loader2 size={12} className="spin" /> Switching…</button>
            : <button className="btn ghost xs" onClick={() => axi.switchSource()} title="Pick a different screen or window"><RefreshCw size={12} /> Switch source</button>}
          {phase === 'AWAITING_APPROVAL' ? null
            : <button className="btn ghost xs" onClick={() => setEditingMasks((v) => !v)} title="Black out chat or other areas on the stream"><Shield size={12} /> Masks</button>}
          {capture && phase !== 'AWAITING_APPROVAL'
            ? <button className="btn ghost xs" onClick={() => axi.fitWindowToCapture()}
                title={state.windowFitted ? 'Back to the default window size' : "Resize the window to the game's aspect (removes letterbox bars)"}>
                <Scan size={12} /> {state.windowFitted ? 'Unfit' : 'Fit'}
              </button>
            : null}
          <span className="spacer" />
          <StatChips stats={stats} capture={capture} encoder={state.encoder} />
        </div>

        {phase === 'NEEDS_YOUTUBE' ? (
          <button className="btn primary action" onClick={() => axi.connectYouTube()}>
            <Radio size={15} /> Connect YouTube to go live
          </button>
        ) : live ? (
          <button className="btn danger action" onClick={() => axi.stopStream()}><Square size={16} /> End Stream</button>
        ) : (
          <button className="btn primary action"
            disabled={phase === 'GOING_LIVE' || phase === 'STARTING_ON_YOUTUBE'}
            onClick={() => axi.goLive()}>
            {phase === 'GOING_LIVE' ? 'Starting…'
              : phase === 'STARTING_ON_YOUTUBE' ? 'Starting on YouTube…'
              : <><Radio size={15} /> Go Live</>}
          </button>
        )}
        {state.watchUrl ? (
          <button className="btn ghost sm" onClick={copyLink} title="Copy the YouTube watch link">
            {copied ? <><Check size={14} /> Copied!</> : <><Link size={14} /> Copy link</>}
          </button>
        ) : null}
      </div>
    </div>
  )
}
