import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { AxiApi, RecordingState } from '../../shared/state.js'

export function RecordingSettings({ recording, axi }: { recording: RecordingState; axi: AxiApi }) {
  const [error, setError] = useState<string | null>(null)
  const choose = async () => {
    const r = await axi.chooseRecordDir()
    setError(r.ok || !r.error ? null : r.error)
  }

  return (
    <>
      <h3>Recording</h3>
      <p className="muted">Recordings are saved as MP4 at your stream's quality.</p>
      <p className="mono summary-path">{recording.dir}</p>
      <button className="btn ghost" onClick={() => void choose()}><FolderOpen size={14} /> Change folder</button>
      {/* Stated up front rather than discovered when a recording dies. */}
      <p className="muted">Must be inside your home folder — AxiStream's OBS can't write outside it.</p>
      {error ? <p className="field-err" role="alert">{error}</p> : null}
    </>
  )
}
