import { X } from 'lucide-react'

// A banner rather than a gate: someone who already knows what they're doing
// must be able to hit Go Live straight past it.
export function WelcomeBanner({ onSetUp, onDismiss }: { onSetUp: () => void; onDismiss: () => void }) {
  return (
    <div className="welcome-banner">
      <span>New to AxiStream? A two-minute setup gets you live.</span>
      <button className="btn primary xs" onClick={onSetUp}>Set up</button>
      <button className="welcome-x" aria-label="Dismiss" onClick={onDismiss}><X size={13} /></button>
    </div>
  )
}
