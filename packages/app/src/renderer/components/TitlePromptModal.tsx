import { useState } from 'react'
import type { AxiApi } from '../../shared/state.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi

export function TitlePromptModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('')
  const submit = () => { if (!title.trim()) return; axi().goLive(title.trim()); onClose() }
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Name your stream</h3>
        <input autoFocus type="text" value={title} placeholder="Stream title"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button disabled={!title.trim()} onClick={submit}>Go Live</button>
        </div>
      </div>
    </div>
  )
}
