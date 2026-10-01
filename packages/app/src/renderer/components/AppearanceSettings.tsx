import { useState } from 'react'
import {
  ACCENTS,
  SURFACES,
  applyAccent,
  applySurface,
  readAccent,
  readSurface
} from '../appearance.js'
import type { SurfaceId } from '../appearance.js'

export function AppearanceSettings() {
  // Seeded from storage rather than from props: appearance is renderer-only and
  // main.tsx has already applied it before this ever renders.
  const [accent, setAccent] = useState(readAccent)
  const [surface, setSurface] = useState<SurfaceId>(readSurface)

  return (
    <>
      <h3>Appearance</h3>
      <p className="axi-ink-dim">Shared with every other axi application.</p>

      <div className="axi-stack">
        <div className="axi-ink-dim">Accent</div>
        <div className="quickrow">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              title={a.label}
              aria-label={a.label}
              aria-pressed={a.id === accent}
              className="axi-btn accent-swatch"
              // A swatch has to show the colour it selects, which is the one
              // place in this migration a value comes from data, not a token.
              style={{ background: a.hex }}
              onClick={() => setAccent(applyAccent(a.id))}
            />
          ))}
        </div>
      </div>

      <div className="axi-stack">
        <div className="axi-ink-dim">Surface</div>
        <div className="quickrow">
          {SURFACES.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === surface}
              className={`axi-btn axi-btn--sm${s.id === surface ? ' axi-btn--primary' : ''}`}
              onClick={() => setSurface(applySurface(s.id))}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
