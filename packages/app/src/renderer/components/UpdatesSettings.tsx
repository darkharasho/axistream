import { useEffect, useState } from 'react'
import type { AxiApi, UpdateStatus } from '../../shared/state.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi

export function UpdatesSettings() {
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [notes, setNotes] = useState<{ version: string; notes: string } | null>(null)

  useEffect(() => { axi().appVersion().then(setVersion) }, [])
  useEffect(() => axi().onUpdateStatus(setStatus), [])
  useEffect(() => { axi().getWhatsNew().then((w) => { if (w.notes) setNotes({ version: w.version, notes: w.notes }) }) }, [])

  const busy = status?.state === 'checking' || status?.state === 'downloading'
  const line = (): string => {
    switch (status?.state) {
      case 'checking': return 'Checking…'
      case 'downloading': return `Downloading ${status.percent}%`
      case 'available': return `Version ${status.version} available`
      case 'ready': return `Version ${status.version} ready`
      case 'none': return 'Up to date'
      case 'error': return status.message
      default: return ''
    }
  }

  return (
    <section className="yt-settings">
      <h3>Updates</h3>
      <p className="axi-ink-dim">AxiStream {version}</p>
      <div className="axi-row">
        <button className="axi-btn axi-btn--ghost axi-btn--sm" disabled={busy} onClick={() => axi().checkForUpdates()}>Check for updates</button>
        {status?.state === 'ready' && <button className="axi-btn axi-btn--primary axi-btn--sm" onClick={() => axi().installUpdate()}>Restart &amp; update</button>}
        {status && <span className={status.state === 'error' ? 'field-err' : 'axi-ink-dim'}>{line()}</span>}
      </div>
      {notes && (
        <div className="axi-prose whatsnew">
          <h4>What&apos;s new in {notes.version}</h4>
          <pre className="whatsnew-body">{notes.notes}</pre>
          <button className="axi-btn axi-btn--ghost axi-btn--xs" onClick={() => { axi().setLastSeenVersion(notes.version); setNotes(null) }}>Got it</button>
        </div>
      )}
    </section>
  )
}
