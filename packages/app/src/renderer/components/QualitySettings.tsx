import { useState } from 'react'
import type { AppState, AxiApi } from '../../shared/state.js'
import { QUALITY_HEIGHTS, QUALITY_FPS, MIN_BITRATE_KBPS, MAX_BITRATE_KBPS, AUTO_MAX_HEIGHT, AUTO_FPS } from '../../shared/state.js'

export function QualitySettings({ state, axi }: { state: AppState; axi: AxiApi }) {
  const [open, setOpen] = useState(false)
  const q = state.quality
  const { capture } = state
  const live = state.phase === 'LIVE' || state.phase === 'RECONNECTING'

  const isCustom = q.height !== null || q.fps !== null || q.bitrateKbps !== null || q.preferSoftware
  const resolved = capture ? `${capture.outputHeight}p${capture.fps}` : '—'
  const bitrate = state.videoBitrateKbps ? `${state.videoBitrateKbps} kbps` : '—'
  const summary = `${isCustom ? 'Custom' : 'Auto'} · ${resolved} · ${bitrate} · ${state.encoder}`

  // Auto resolves from the monitor's NATIVE height, not the current output —
  // otherwise a custom 720p would make the Auto option label itself "720p".
  const autoHeight = capture ? Math.min(capture.height, AUTO_MAX_HEIGHT) : AUTO_MAX_HEIGHT
  const heights = QUALITY_HEIGHTS.filter((h) => !capture || h <= capture.height)

  const manualBitrate = q.bitrateKbps !== null

  return (
    <div className="quality-settings">
      <button className="quality-header" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <h3>Quality</h3>
        <span className="muted">{summary}</span>
      </button>
      {live ? <p className="muted">Applies to your next stream.</p> : null}

      {open ? (
        <div className="quality-body">
          <label>
            <span>Resolution</span>
            <select
              value={q.height === null ? 'auto' : String(q.height)}
              onChange={(e) => void axi.setQuality({ height: e.target.value === 'auto' ? null : Number(e.target.value) })}
            >
              <option value="auto">{`Auto (${autoHeight}p)`}</option>
              {heights.map((h) => <option key={h} value={h}>{`${h}p`}</option>)}
            </select>
          </label>

          <label>
            <span>Frame rate</span>
            <select
              value={q.fps === null ? 'auto' : String(q.fps)}
              onChange={(e) => void axi.setQuality({ fps: e.target.value === 'auto' ? null : Number(e.target.value) })}
            >
              <option value="auto">{`Auto (${AUTO_FPS})`}</option>
              {QUALITY_FPS.map((f) => <option key={f} value={f}>{String(f)}</option>)}
            </select>
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={manualBitrate}
              /* Seed from what auto had chosen so the box is never empty and
                 the first edit is a nudge, not a from-scratch guess. */
              onChange={(e) => void axi.setQuality({ bitrateKbps: e.target.checked ? (state.videoBitrateKbps ?? 6000) : null })}
            />
            Set the bitrate manually
          </label>

          {manualBitrate ? (
            <label>
              <span>Bitrate (kbps)</span>
              <input
                type="number"
                min={MIN_BITRATE_KBPS}
                max={MAX_BITRATE_KBPS}
                step={500}
                value={q.bitrateKbps ?? 0}
                onChange={(e) => void axi.setQuality({ bitrateKbps: Number(e.target.value) })}
              />
            </label>
          ) : null}

          <label className="check">
            <input
              type="checkbox"
              checked={q.preferSoftware}
              onChange={(e) => void axi.setQuality({ preferSoftware: e.target.checked })}
            />
            Software encoding
          </label>
          <p className="muted">
            {q.preferSoftware && q.preferSoftwareAuto
              ? 'AxiStream switched to software encoding after a stream failed to start — untick to try your graphics card again.'
              : 'Use the CPU instead of your graphics card. Slower, but works everywhere.'}
          </p>
        </div>
      ) : null}
    </div>
  )
}
