import { useEffect, useRef, useState } from 'react'
import type { AppState, AxiApi } from '../../shared/state.js'
import { QUALITY_HEIGHTS, QUALITY_FPS, MIN_BITRATE_KBPS, MAX_BITRATE_KBPS, AUTO_MAX_HEIGHT, AUTO_FPS, isStreamingPhase } from '../../shared/state.js'

export function QualitySettings({ state, axi }: { state: AppState; axi: AxiApi }) {
  const q = state.quality
  const { capture } = state
  const live = isStreamingPhase(state.phase)

  const isCustom = q.height !== null || q.fps !== null || q.bitrateKbps !== null || q.preferSoftware
  const resolved = capture ? `${capture.outputHeight}p${capture.fps}` : '—'
  const bitrate = state.videoBitrateKbps ? `${state.videoBitrateKbps} kbps` : '—'

  // Auto resolves from the monitor's NATIVE height, not the current output —
  // otherwise a custom 720p would make the Auto option label itself "720p".
  const autoHeight = capture ? Math.min(capture.height, AUTO_MAX_HEIGHT) : AUTO_MAX_HEIGHT
  const heights = QUALITY_HEIGHTS.filter((h) => !capture || h <= capture.height)
  // A persisted height can outlive the monitor it was set on (e.g. settings.json
  // still carries 1440 after moving to a 1080p display). Behaviorally harmless —
  // applyCaptureResolution never upscales — but the <select> would otherwise land
  // on a value with no matching <option> and silently fall back to displaying
  // "Auto", contradicting the "Custom" summary above it. Surface it honestly
  // instead of hiding it.
  const phantomHeight = q.height !== null && !heights.includes(q.height) ? q.height : null

  const manualBitrate = q.bitrateKbps !== null

  // The bitrate field is a controlled input backed by local state rather than
  // q.bitrateKbps directly: main clamps every write to [MIN, MAX] and pushes
  // the clamped value straight back, which — if the field mirrored the prop
  // live — stomps every keystroke of a value below the clamp floor (typing
  // "3" of "3000" round-trips as "1000" before the next digit lands). Local
  // state lets the user finish typing; the edit is only sent (and only then
  // subject to clamping) on blur or Enter. Re-synced from the prop whenever
  // it changes and the field isn't focused, so external changes (e.g. the
  // seed-from-auto checkbox, or another window) still show up.
  const [bitrateInput, setBitrateInput] = useState(() => String(q.bitrateKbps ?? ''))
  const bitrateFocused = useRef(false)
  useEffect(() => {
    if (!bitrateFocused.current) setBitrateInput(String(q.bitrateKbps ?? ''))
  }, [q.bitrateKbps])
  const commitBitrate = () => {
    const n = Number(bitrateInput)
    if (Number.isFinite(n) && bitrateInput.trim() !== '') void axi.setQuality({ bitrateKbps: n })
    // An empty/invalid field (e.g. the user cleared it and blurred) has
    // nothing to commit — fall back to the last known-good value rather than
    // leaving the box empty forever.
    else setBitrateInput(String(q.bitrateKbps ?? ''))
  }

  return (
    <div className="quality-settings">
      <h3>Quality</h3>
      {/* What the stream is actually getting, as chips: the mode is what you
          scan for, so it leads and carries the accent. */}
      <div className="quality-chips">
        <span className={isCustom ? 'q-chip mode custom' : 'q-chip mode'}>{isCustom ? 'Custom' : 'Auto'}</span>
        <span className="q-chip">{resolved}</span>
        <span className="q-chip">{bitrate}</span>
        <span className="q-chip">{state.encoder}</span>
      </div>

      <div className="quality-body">
        {live ? <p className="q-note">Applies to your next stream.</p> : null}
        <label>
          <span>Resolution</span>
          <select
            value={q.height === null ? 'auto' : String(q.height)}
            onChange={(e) => void axi.setQuality({ height: e.target.value === 'auto' ? null : Number(e.target.value) })}
          >
            <option value="auto">{`Auto (${autoHeight}p)`}</option>
            {heights.map((h) => <option key={h} value={h}>{`${h}p`}</option>)}
            {phantomHeight !== null ? <option value={phantomHeight}>{`${phantomHeight}p (above this monitor)`}</option> : null}
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
          <label className="q-sub">
            <span>Bitrate (kbps)</span>
            <input
              type="number"
              min={MIN_BITRATE_KBPS}
              max={MAX_BITRATE_KBPS}
              step={500}
              value={bitrateInput}
              onChange={(e) => setBitrateInput(e.target.value)}
              onFocus={() => { bitrateFocused.current = true }}
              onBlur={() => { bitrateFocused.current = false; commitBitrate() }}
              onKeyDown={(e) => { if (e.key === 'Enter') commitBitrate() }}
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
        {/* A fallback the app chose is state, not advice — it gets its own
            weight rather than sitting at hint level. */}
        {q.preferSoftware && q.preferSoftwareAuto ? (
          <p className="q-fallback">AxiStream switched to software encoding after a stream failed to start — untick to try your graphics card again.</p>
        ) : (
          <p className="muted">Use the CPU instead of your graphics card. Slower, but works everywhere.</p>
        )}
      </div>
    </div>
  )
}
