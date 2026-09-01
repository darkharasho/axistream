import { useState } from 'react'
import type { AxiApi } from '../../shared/state.js'

export function DiagnosticsSettings({ axi }: { axi: AxiApi }) {
  const [busy, setBusy] = useState(false)
  // Keep the last bundle's path so the user has something to act on after the
  // toast fades — a path they can't find is a bundle they can't send.
  const [path, setPath] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const run = async (): Promise<void> => {
    setBusy(true)
    setCopied(false)
    // Failures are reported through the toast channel from main; here we only
    // need the path of a bundle that actually got written.
    try {
      const r = await axi.exportDiagnostics()
      setPath(r.ok && r.path ? r.path : null)
    } finally { setBusy(false) }
  }

  const copy = async (): Promise<void> => {
    if (!path) return
    const ok = await axi.copyToClipboard(path)
    setCopied(ok)
  }

  return (
    <>
      <h3>Diagnostics</h3>
      <p className="muted">
        Bundles the app log, OBS&apos;s logs, and your encoder and device settings into a zip
        you can send us. Your stream key, YouTube sign-in, and Discord webhook are left out.
      </p>
      <button className="btn ghost" disabled={busy} onClick={() => void run()}>
        {busy ? 'Collecting…' : 'Export diagnostics'}
      </button>
      {path && (
        <>
          <p className="muted">Bundle saved — attach this file to your report.</p>
          <p className="mono summary-path">{path}</p>
          <div className="yt-account">
            <button className="btn ghost sm" onClick={() => void axi.revealFile(path)}>Show in folder</button>
            <button className="btn ghost sm" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy path'}</button>
          </div>
        </>
      )}
    </>
  )
}
