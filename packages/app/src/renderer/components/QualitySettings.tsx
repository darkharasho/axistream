import { useEffect, useRef, useState } from 'react'
import type { AppState, AxiApi } from '../../shared/state.js'
import { QUALITY_HEIGHTS, QUALITY_FPS, MIN_BITRATE_KBPS, MAX_BITRATE_KBPS, AUTO_MAX_HEIGHT, AUTO_FPS, isStreamingPhase } from '../../shared/state.js'
import { ENCODER_ENTRIES, encoderAvailability, type DisabledReason } from '@axistream/capture'

/** Short enough to sit inside an <option>; the full sentence goes under the
 *  select when the current selection is the unavailable one. */
const REASON_SHORT: Record<DisabledReason, string> = {
  'enhanced-rtmp': 'needs enhanced RTMP',
  'no-nvidia': 'no NVIDIA GPU detected',
  'no-amd': 'no AMD GPU detected',
  'amf-windows-only': 'Windows only',
  'vaapi-advanced-mode': 'not yet supported',
}

const REASON_LONG: Record<DisabledReason, string> = {
  'enhanced-rtmp': 'This codec needs enhanced RTMP, which the current YouTube ingest does not support yet. AxiStream will use your next best encoder.',
  'no-nvidia': 'No NVIDIA GPU detected on this machine.',
  'no-amd': 'No AMD GPU detected on this machine.',
  'amf-windows-only': 'AMD hardware encoding is only available on Windows.',
  'vaapi-advanced-mode': 'VAAPI needs OBS advanced output mode, which AxiStream does not use yet.',
}

export function QualitySettings({ state, axi }: { state: AppState; axi: AxiApi }) {
  const q = state.quality
  const { capture } = state
  const live = isStreamingPhase(state.phase)

  const isCustom = q.height !== null || q.fps !== null || q.bitrateKbps !== null || q.encoder !== 'auto'
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

  // A persisted selection can outlive the GPU it was set on, or stay blocked
  // by the ingest. Keep it selected and explain it, rather than letting the
  // <select> fall back to a value the user never picked — same reasoning as
  // phantomHeight above.
  const selectedEntry = ENCODER_ENTRIES.find((e) => e.id === q.encoder)
  const selectedAvail = selectedEntry ? encoderAvailability(selectedEntry, state.gpuVendor, state.platform) : 'ok'
  const selectedReason: DisabledReason | null = selectedAvail === 'ok' ? null : selectedAvail

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

        <label>
          <span>Encoder</span>
          <select
            value={q.encoder}
            onChange={(e) => void axi.setQuality({ encoder: e.target.value as typeof q.encoder })}
          >
            <option value="auto">{`Auto (${state.encoder})`}</option>
            {ENCODER_ENTRIES.map((entry) => {
              const avail = encoderAvailability(entry, state.gpuVendor, state.platform)
              return (
                <option key={entry.id} value={entry.id} disabled={avail !== 'ok'}>
                  {avail === 'ok' ? entry.label : `${entry.label} — ${REASON_SHORT[avail]}`}
                </option>
              )
            })}
          </select>
        </label>

        {/* A fallback the app chose is state, not advice — it gets its own
            weight rather than sitting at hint level. */}
        {q.encoder === 'x264' && q.encoderAuto ? (
          <p className="q-fallback">AxiStream switched to software encoding after a stream failed to start — pick your graphics card again to retry it.</p>
        ) : selectedReason ? (
          <p className="q-fallback">{REASON_LONG[selectedReason]}</p>
        ) : (
          <p className="muted">Auto picks the fastest encoder your graphics card supports.</p>
        )}
      </div>
    </div>
  )
}
