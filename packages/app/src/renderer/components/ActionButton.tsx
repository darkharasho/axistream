import { useEffect, useRef, useState } from 'react'
import { ChevronUp, Radio, Square } from 'lucide-react'
import type { AppState, AxiApi } from '../../shared/state.js'
import { RecordMenuItems } from './RecordButton.js'

/** The primary stream action plus a drop-up holding the recording controls. */
export function ActionButton({ state, axi }: { state: AppState; axi: AxiApi }) {
  const { phase } = state
  const live = phase === 'LIVE' || phase === 'RECONNECTING'
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  // The drop-up floats over the video preview with no backdrop element to
  // click, so dismissal is wired to the document instead.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const starting = phase === 'GOING_LIVE' || phase === 'STARTING_ON_YOUTUBE'
  const tone = live ? 'danger' : 'primary'
  const primary = live
    ? { disabled: false, onClick: () => axi.stopStream(), label: <><Square size={16} /> End Stream</> }
    : phase === 'NEEDS_YOUTUBE'
      ? { disabled: false, onClick: () => axi.connectYouTube(), label: <><Radio size={15} /> Connect YouTube to go live</> }
      : {
          disabled: starting,
          onClick: () => axi.goLive(),
          label: phase === 'GOING_LIVE' ? 'Starting…'
            : phase === 'STARTING_ON_YOUTUBE' ? 'Starting on YouTube…'
            : <><Radio size={15} /> Go Live</>,
        }

  return (
    <div className="action-split" ref={wrap}>
      <button className={`btn ${tone} action`} disabled={primary.disabled} onClick={primary.onClick}>
        {primary.label}
      </button>
      <button
        className={`btn ${tone} action caret`}
        aria-label="More stream actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {/* Recording is otherwise invisible once it moves into the menu, so the
            caret carries the indicator. */}
        {state.recording.active ? <span className="rec-dot" title="Recording" /> : null}
        <ChevronUp size={16} />
      </button>
      {open ? (
        <div className="dropup" role="menu" aria-label="More stream actions">
          <RecordMenuItems recording={state.recording} disabled={state.audioTestActive}
            axi={axi} onAct={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  )
}
