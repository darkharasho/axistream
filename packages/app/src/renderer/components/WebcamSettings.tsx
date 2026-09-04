import { useEffect, useState } from 'react'
import type { AudioDevice, AxiApi, WebcamCorner, WebcamProps, WebcamView } from '../../shared/state.js'
import { WEBCAM_MIN_SIZE_PCT, WEBCAM_MAX_SIZE_PCT } from '../../shared/state.js'
import { Select } from './Select.js'

const CORNERS: { value: WebcamCorner; label: string }[] = [
  { value: 'tl', label: 'Top left' },
  { value: 'tr', label: 'Top right' },
  { value: 'bl', label: 'Bottom left' },
  { value: 'br', label: 'Bottom right' },
]

const EMPTY_PROPS: WebcamProps = { pixelformats: [], resolutions: [], framerates: [] }

export function WebcamSettings({ webcam, axi }: { webcam: WebcamView; axi: AxiApi }) {
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [props, setProps] = useState<WebcamProps>(EMPTY_PROPS)

  useEffect(() => { void axi.getWebcamDevices().then(setDevices) }, [axi])

  // The three property lists are dependent — OBS recomputes framerates from
  // the current resolution — so they are re-fetched after every mode change
  // rather than cached.
  useEffect(() => {
    if (!webcam.deviceId) { setProps(EMPTY_PROPS); return }
    void axi.getWebcamProps().then(setProps)
  }, [axi, webcam.deviceId, webcam.mode])

  const manual = webcam.mode !== null
  const setMode = (patch: Partial<NonNullable<WebcamView['mode']>>) => {
    const base = webcam.mode ?? {
      pixelformat: props.pixelformats[0]?.value ?? '',
      resolution: props.resolutions[0]?.value ?? '',
      framerate: props.framerates[0]?.value ?? '',
    }
    void axi.setWebcam({ mode: { ...base, ...patch } })
  }

  const sizePct = Math.round(webcam.sizePct * 100)
  const minPct = Math.round(WEBCAM_MIN_SIZE_PCT * 100)
  const maxPct = Math.round(WEBCAM_MAX_SIZE_PCT * 100)

  return (
    <div className="webcam-settings">
      <h3>Camera</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={webcam.enabled}
          onChange={(e) => void axi.setWebcam({ enabled: e.target.checked })}
        />
        Show my camera on stream
      </label>

      <Select
        label="Camera"
        value={webcam.deviceId ?? ''}
        onChange={(v) => {
          const id = v || null
          const name = devices.find((d) => d.id === id)?.name ?? null
          void axi.setWebcam({ deviceId: id, deviceLabel: name, mode: null })
        }}
        options={[
          { value: '', label: 'Select a camera…' },
          ...devices.map((d) => ({ value: d.id, label: d.name })),
        ]}
      />

      {webcam.enabled && webcam.deviceId && !webcam.available && (
        <p className="muted">Camera unavailable — the stream continues without it.</p>
      )}

      <div className="webcam-corners">
        {CORNERS.map((c) => (
          <button
            key={c.value}
            className={webcam.corner === c.value ? 'btn' : 'btn ghost'}
            onClick={() => void axi.setWebcam({ corner: c.value })}
          >{c.label}</button>
        ))}
      </div>

      <label className="slider">
        <span className="slider-label">Size</span>
        <span className="slider-value">{sizePct}%</span>
        <input
          type="range"
          min={minPct}
          max={maxPct}
          value={sizePct}
          /* The filled part of the track is painted by a background gradient
             sized from this variable — a native range cannot style it. */
          style={{ ['--fill' as string]: `${((sizePct - minPct) / (maxPct - minPct)) * 100}%` }}
          onChange={(e) => void axi.setWebcam({ sizePct: Number(e.target.value) / 100 })}
        />
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={webcam.mirrored}
          onChange={(e) => void axi.setWebcam({ mirrored: e.target.checked })}
        />
        Mirror my camera
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={manual}
          onChange={(e) => e.target.checked ? setMode({}) : void axi.setWebcam({ mode: null })}
        />
        Choose the camera format manually
      </label>

      {manual && (
        <div className="webcam-modes">
          <Select label="Format" value={webcam.mode?.pixelformat ?? ''}
            onChange={(v) => setMode({ pixelformat: v })} options={props.pixelformats} />
          <Select label="Resolution" value={webcam.mode?.resolution ?? ''}
            onChange={(v) => setMode({ resolution: v })} options={props.resolutions} />
          <Select label="Frame rate" value={webcam.mode?.framerate ?? ''}
            onChange={(v) => setMode({ framerate: v })} options={props.framerates} />
        </div>
      )}
    </div>
  )
}
