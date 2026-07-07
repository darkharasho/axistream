import { Radio, Settings, Mic, MicOff, Eye, EyeOff, Keyboard, Download } from 'lucide-react'
import { AxiMark } from './AxiMark.js'
import type { AppState, AxiApi, UpdateStatus } from '../../shared/state.js'

const ICON = 16

export function Sidebar({ active, state, onNav, axi, update = null }: { active: 'stream' | 'settings'; state: AppState; onNav: (s: 'stream' | 'settings') => void; axi: AxiApi; update?: UpdateStatus | null }) {
  const live = state.phase === 'LIVE' || state.phase === 'RECONNECTING'
  const { audio, masks, masksVisible, ptt } = state
  return (
    <div className="sidebar">
      <div className="brand"><AxiMark size={20} /><span className="wordmark"><span>Axi</span><span className="accent">Stream</span></span></div>
      <div className="menu-label">MENU</div>
      <button className={`navitem ${active === 'stream' ? 'on' : ''}`} onClick={() => onNav('stream')}><Radio size={ICON} /> Stream</button>
      <button className={`navitem ${active === 'settings' ? 'on' : ''}`} onClick={() => onNav('settings')}><Settings size={ICON} /> Settings</button>

      <div className="quick">
        <div className="menu-label">QUICK</div>
        <div className="quickrow">
          <button className={`qt ${audio.micEnabled ? 'on' : ''}`} aria-label="Quick toggle microphone"
            title={audio.micEnabled ? 'Microphone is on — click to mute on stream' : 'Microphone is off'}
            onClick={() => axi.setMicEnabled(!audio.micEnabled)}>
            {audio.micEnabled ? <Mic size={14} /> : <MicOff size={14} />}
          </button>
          <button className={`qt ${masksVisible && masks.length ? 'on' : ''}`} aria-label="Quick toggle masks" disabled={!masks.length}
            title={!masks.length ? 'No masks set up yet' : masksVisible ? 'Masks are hiding areas on stream — click to reveal' : 'Masks are OFF — click to hide areas again'}
            onClick={() => axi.setMasksVisible(!masksVisible)}>
            {masksVisible && masks.length ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          {ptt.available && (
            <button className={`qt ${ptt.enabled ? 'on' : ''} ${ptt.active ? 'tx' : ''}`} aria-label="Quick toggle push to talk" disabled={!audio.micEnabled}
              title={!audio.micEnabled ? 'Enable the microphone first' : ptt.active ? 'Transmitting' : ptt.enabled ? `Push to talk armed — hold ${ptt.keyName} to speak` : 'Push to talk is off'}
              onClick={() => axi.setPttEnabled(!ptt.enabled)}>
              <Keyboard size={14} />
            </button>
          )}
        </div>
      </div>

      {update?.state === 'ready' && (
        <button className="updatepill" onClick={() => axi.installUpdate()} title={`Version ${update.version} downloaded — restart to apply`}>
          <Download size={12} /> Update ready
        </button>
      )}
      {update?.state === 'downloading' && (
        <div className="updatepill passive">Updating… {update.percent}%</div>
      )}
      <div className={`enginepill ${live ? 'onair' : ''}`}>
        <span className="dot" /> {live ? 'On air' : 'Engine ready'}
      </div>
    </div>
  )
}
