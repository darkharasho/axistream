import { useEffect, useState } from 'react'
import { Circle, Square, FolderOpen } from 'lucide-react'
import type { AxiApi, RecordingState } from '../../shared/state.js'

/** m:ss, or h:mm:ss past an hour — a three-hour session should not read 183:04. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export interface RecordMenuItemsProps {
  recording: RecordingState
  disabled: boolean
  axi: AxiApi
  /** Closes the drop-up that owns these items; a menu that stays open after a
      choice reads as a click that did nothing. */
  onAct?: () => void
}

/** The recording controls, shaped as menu items for the Go Live drop-up. */
export function RecordMenuItems({ recording, disabled, axi, onAct }: RecordMenuItemsProps) {
  // Elapsed time is derived here rather than pushed from main: a per-second
  // counter over IPC would be a second stats channel carrying one number.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!recording.active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [recording.active])

  // Hoisted: TS does not carry a property narrowing into the click handler
  // below, and a cast there would outlive whatever made it true.
  const lastPath = recording.lastPath

  return (
    <>
      {recording.active ? (
        <button className="dropup-item danger" role="menuitem"
          onClick={() => { onAct?.(); void axi.stopRecording() }}
          title="Stop the local recording">
          <Square size={13} /> Stop recording
          <span className="mono rec-elapsed">{formatElapsed(now - (recording.startedAt ?? now))}</span>
        </button>
      ) : (
        <button className="dropup-item" role="menuitem" disabled={disabled}
          onClick={() => { onAct?.(); void axi.startRecording() }}
          title={disabled ? 'Not while an audio test is running' : 'Save a local copy of what you are capturing'}>
          <Circle size={13} /> Record
        </button>
      )}
      {lastPath ? (
        <button className="dropup-item" role="menuitem"
          onClick={() => { onAct?.(); void axi.openRecording(lastPath) }} title={lastPath}>
          <FolderOpen size={13} /> Open recording
        </button>
      ) : null}
    </>
  )
}
