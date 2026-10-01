import { useRef, useState } from 'react'
import type { AxiApi } from '../../shared/state.js'
import { useModalKeys } from '../use-modal-keys.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi

export function TitlePromptModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useModalKeys(ref, onClose)
  const submit = () => { if (!title.trim()) return; axi().goLive(title.trim()).catch(console.error); onClose() }
  return (
    <div className="axi-scrim modal-backdrop">
      <div className="axi-modal title-prompt" ref={ref} role="dialog" aria-modal="true" aria-label="Name your stream">
        <div className="axi-modal__head"><h3>Name your stream</h3></div>
        <div className="axi-modal__body">
          <input className="axi-input" autoFocus type="text" value={title} placeholder="Stream title"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
        </div>
        <div className="axi-modal__foot">
          <button className="axi-btn axi-btn--ghost axi-btn--sm" onClick={onClose}>Cancel</button>
          <button className="axi-btn axi-btn--primary axi-btn--sm" disabled={!title.trim()} onClick={submit}>Go Live</button>
        </div>
      </div>
    </div>
  )
}
