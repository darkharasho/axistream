import { useState } from 'react'
import { PTT_KEY_GROUPS, MODIFIER_LABELS, MODIFIER_CODES, type PttBinding, type PttKey, type PttModifier } from '../../shared/keys.js'

const TYPING_GROUPS = new Set(['Letters', 'Numbers'])
const typingKey = (code: number) => PTT_KEY_GROUPS.some((g) => TYPING_GROUPS.has(g.label) && g.keys.some((k) => k.code === code))

export function PttKeyPicker({ keyName, keyCode, modifier, onBind }: {
  keyName: string
  keyCode: number
  modifier: PttModifier | null
  onBind: (b: PttBinding) => void
}) {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const key: PttKey = { code: keyCode, name: keyName }
  const q = query.trim().toLowerCase()
  return (
    <div className="keypicker">
      <div className="keypicker-combo">
        {modifier && (
          <span className="keypicker-chip">
            {MODIFIER_LABELS[modifier]}
            <button aria-label="remove modifier" className="keypicker-x" onClick={() => onBind({ key, modifier: null })}>✕</button>
          </span>
        )}
        {modifier && <span className="keypicker-plus">+</span>}
        <button className="keypicker-key" onClick={() => setOpen((o) => !o)}>{keyName}</button>
        <div className="keypicker-menu">
          <button className="keypicker-addmod" onClick={() => setMenuOpen((m) => !m)}>+ modifier</button>
          {menuOpen && (
            <div className="keypicker-menulist">
              {(Object.keys(MODIFIER_LABELS) as PttModifier[]).filter((m) => !MODIFIER_CODES[m].includes(keyCode)).map((m) => (
                <button key={m} onClick={() => { setMenuOpen(false); onBind({ key, modifier: m }) }}>{MODIFIER_LABELS[m]}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      {open && (
        <div className="keypicker-grid">
          <input placeholder="Search keys… (e.g. f18, v, pageup)" value={query} onChange={(e) => setQuery(e.target.value)} />
          {PTT_KEY_GROUPS.map((g) => {
            const keys = g.keys.filter((k) => k.name.toLowerCase().includes(q))
            if (keys.length === 0) return null
            return (
              <div key={g.label} className="keypicker-group">
                <div className="keypicker-glabel">{g.label}</div>
                <div className="keypicker-keys">
                  {keys.map((k) => (
                    <button key={k.code} className={k.code === keyCode ? 'keypicker-k sel' : 'keypicker-k'}
                      onClick={() => onBind({ key: k, modifier })}>{k.name}</button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {typingKey(keyCode) && <p className="muted">Heads up: this key triggers PTT while typing anywhere.</p>}
    </div>
  )
}
