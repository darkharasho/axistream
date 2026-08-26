import { useEffect, useState } from 'react'
import type { AxiApi } from '../../shared/state.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi

const REPO = 'https://github.com/darkharasho/axistream'
const LINKS = [
  { label: 'How we bundle OBS', url: `${REPO}/blob/main/docs/obs-redistribution.md` },
  { label: 'Source for the bundled OBS', url: `${REPO}/releases/latest` },
  { label: 'Licenses', url: `${REPO}/blob/main/THIRD_PARTY_NOTICES.md` },
  { label: 'Privacy policy', url: `${REPO}/blob/main/PRIVACY.md` },
  { label: 'Repository', url: REPO },
  { label: 'Report an issue', url: `${REPO}/issues/new` },
]

export function AboutSettings({ onRunSetup }: { onRunSetup: () => void }) {
  const [version, setVersion] = useState('')
  useEffect(() => { void axi().appVersion().then(setVersion) }, [])

  return (
    <section className="setting">
      <h3>About</h3>
      <p className="muted">AxiStream {version}</p>
      <button className="btn ghost sm" onClick={onRunSetup}>Run setup again</button>
      <p className="muted about-obs">
        AxiStream bundles OBS Studio 32.1.2, licensed GPL-2.0-or-later. The corresponding
        source is attached to every release.
      </p>
      <div className="about-links">
        {LINKS.map((l) => (
          <button key={l.url} className="btn ghost xs" onClick={() => void axi().openExternalUrl(l.url)}>{l.label}</button>
        ))}
      </div>
    </section>
  )
}
