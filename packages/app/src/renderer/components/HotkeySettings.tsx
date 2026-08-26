import { useState } from 'react'
import { HOTKEY_IDS, HOTKEY_LABELS, type Binding, type HotkeyId } from '../../shared/hotkeys.js'
import type { AppState, AxiApi } from '../../shared/state.js'
import { KeyPicker } from './KeyPicker.js'

const MODE_COPY = {
  exclusive: "Bound keys are captured by AxiStream and won't reach Guild Wars 2.",
  passthrough: 'Bound keys still reach Guild Wars 2.',
}

export function HotkeySettings({ hotkeys, axi }: { hotkeys: AppState['hotkeys']; axi: AxiApi }) {
  const [conflict, setConflict] = useState<string | null>(null)
  const bind = async (id: HotkeyId, binding: Binding | null) => {
    setConflict(null)
    const r = await axi.setHotkey(id, binding)
    if (!r.ok) setConflict(`${HOTKEY_LABELS[id]}: that key is already bound to ${r.conflict}.`)
  }
  const alert = conflict ?? hotkeys.error
  return (
    <>
      <h3>Hotkeys</h3>
      <p className="muted">Control AxiStream without leaving the game. Nothing is bound until you set it.</p>
      {hotkeys.mode ? <p className="muted">{MODE_COPY[hotkeys.mode]}</p> : null}
      {alert ? <p className="field-err" role="alert">{alert}</p> : null}
      <div className="hotkey-rows">
        {HOTKEY_IDS.map((id) => (
          <div className="hotkey-row" key={id}>
            <span className="hotkey-label">{HOTKEY_LABELS[id]}</span>
            <KeyPicker binding={hotkeys.bindings[id]} onBind={(b) => void bind(id, b)} onClear={() => void bind(id, null)} />
          </div>
        ))}
      </div>
    </>
  )
}
