import { useEffect, useState } from 'react'
import type { AxiApi } from '../../shared/state.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi

const REPO = 'https://github.com/darkharasho/axistream'
const LINKS = [
  { label: 'How we bundle OBS', url: `${REPO}/blob/main/docs/obs-redistribution.md` },
  { label: 'Source for the bundled OBS', url: `${REPO}/releases/latest` },
  { label: 'License (MIT)', url: `${REPO}/blob/main/LICENSE` },
  { label: 'Third-party licenses', url: `${REPO}/blob/main/THIRD_PARTY_NOTICES.md` },
  { label: 'Privacy policy', url: `${REPO}/blob/main/PRIVACY.md` },
  { label: 'Repository', url: REPO },
  { label: 'Report an issue', url: `${REPO}/issues/new` },
]

export function AboutSettings({ onRunSetup }: { onRunSetup: () => void }) {
  const [version, setVersion] = useState('')
  useEffect(() => { void axi().appVersion().then(setVersion) }, [])

  return (
    <section className="axi-panel">
      <h3>About</h3>
      <p className="axi-ink-dim">AxiStream {version}</p>
      <button className="axi-btn axi-btn--ghost axi-btn--sm" onClick={onRunSetup}>Run setup again</button>
      <p className="axi-ink-dim about-obs">
        AxiStream bundles OBS Studio 32.1.2, licensed GPL-2.0-or-later. The corresponding
        source is attached to every release.
      </p>
      <div className="axi-row about-links">
        {LINKS.map((l) => (
          <button key={l.url} className="axi-link" onClick={() => void axi().openExternalUrl(l.url)}>{l.label}</button>
        ))}
      </div>
    </section>
  )
}
