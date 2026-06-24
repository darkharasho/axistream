import { useState } from 'react'

export function KeyInput({ onSave }: { onSave: (key: string) => void }) {
  const [v, setV] = useState('')
  const valid = v.trim().length >= 8
  return (
    <div className="keyrow">
      <input
        className="keyinput" placeholder="Paste your YouTube stream key" value={v}
        onChange={(e) => setV(e.target.value)} aria-label="stream key"
      />
      <button className="btn primary" disabled={!valid} onClick={() => onSave(v.trim())}>Save key</button>
    </div>
  )
}
