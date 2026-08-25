import { useState } from 'react'
import type { AxiApi } from '../../shared/state.js'

export function DiagnosticsSettings({ axi }: { axi: AxiApi }) {
  const [busy, setBusy] = useState(false)

  const run = async (): Promise<void> => {
    setBusy(true)
    // The result is reported through the toast channel from main, so there is
    // nothing to render here beyond the busy state.
    try { await axi.exportDiagnostics() } finally { setBusy(false) }
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
    </>
  )
}
