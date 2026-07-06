import { Radio, Settings } from 'lucide-react'
import { AxiMark } from './AxiMark.js'
import type { StreamPhase } from '../../shared/state.js'

const ICON = 16

export function Sidebar({ active, phase, onNav }: { active: 'stream' | 'settings'; phase: StreamPhase; onNav: (s: 'stream' | 'settings') => void }) {
  const live = phase === 'LIVE' || phase === 'RECONNECTING'
  return (
    <div className="sidebar">
      <div className="brand"><AxiMark size={20} /><span className="wordmark"><span>Axi</span><span className="accent">Stream</span></span></div>
      <div className="menu-label">MENU</div>
      <button className={`navitem ${active === 'stream' ? 'on' : ''}`} onClick={() => onNav('stream')}><Radio size={ICON} /> Stream</button>
      <button className={`navitem ${active === 'settings' ? 'on' : ''}`} onClick={() => onNav('settings')}><Settings size={ICON} /> Settings</button>
      <div className={`enginepill ${live ? 'onair' : ''}`}>
        <span className="dot" /> {live ? 'On air' : 'Engine ready'}
      </div>
    </div>
  )
}
