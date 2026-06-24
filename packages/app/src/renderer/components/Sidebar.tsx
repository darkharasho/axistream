import type { StreamPhase } from '../../shared/state.js'

export function Sidebar({ active, phase, onNav }: { active: 'stream' | 'settings'; phase: StreamPhase; onNav: (s: 'stream' | 'settings') => void }) {
  const live = phase === 'LIVE' || phase === 'RECONNECTING'
  return (
    <div className="sidebar">
      <div className="brand"><span className="dot accent" /> AxiStream</div>
      <div className="menu-label">MENU</div>
      <button className={`navitem ${active === 'stream' ? 'on' : ''}`} onClick={() => onNav('stream')}>▶ Stream</button>
      <button className={`navitem ${active === 'settings' ? 'on' : ''}`} onClick={() => onNav('settings')}>⚙ Settings</button>
      <div className="navitem dim">▦ Privacy Masks <span className="soon">SOON</span></div>
      <div className="navitem dim">◇ Presets <span className="soon">SOON</span></div>
      <div className={`enginepill ${live ? 'onair' : ''}`}>
        <span className="dot" /> {live ? 'On air' : 'Engine ready'}
      </div>
    </div>
  )
}
