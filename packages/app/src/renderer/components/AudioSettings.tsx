import { useEffect, useState } from 'react'
import type { AxiApi, AudioDevice, AppState } from '../../shared/state.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi

export function AudioSettings({ audio }: { audio: AppState['audio'] }) {
  const [devices, setDevices] = useState<AudioDevice[]>([])

  useEffect(() => {
    if (!audio.micEnabled) return
    axi().getAudioDevices().then(setDevices)
  }, [audio.micEnabled])

  return (
    <section className="yt-settings">
      <h3>Audio</h3>

      <label className="audio-row">
        <input type="checkbox" checked={audio.desktopEnabled} aria-label="Desktop audio"
          onChange={(e) => axi().setDesktopEnabled(e.target.checked)} />
        <span>Desktop audio</span>
      </label>

      <label className="audio-row">
        <input type="checkbox" checked={audio.micEnabled} aria-label="Microphone"
          onChange={(e) => axi().setMicEnabled(e.target.checked)} />
        <span>Microphone</span>
      </label>

      {audio.micEnabled && (
        <label>Microphone device
          <select value={audio.micDevice ?? ''} onChange={(e) => axi().setMicDevice(e.target.value)}>
            {devices.length === 0 && <option value="">No input devices found</option>}
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      )}
    </section>
  )
}
