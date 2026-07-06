import { useEffect, useState } from 'react'
import type { AxiApi, AudioDevice, AppState } from '../../shared/state.js'
import { staleOption } from '../device-options.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi

export function AudioSettings({ audio }: { audio: AppState['audio'] }) {
  const [micDevices, setMicDevices] = useState<AudioDevice[]>([])
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([])

  useEffect(() => {
    if (!audio.micEnabled) return
    axi().getAudioDevices().then(setMicDevices)
  }, [audio.micEnabled])

  useEffect(() => {
    if (!audio.desktopEnabled) return
    axi().getDesktopDevices().then(setOutputDevices)
  }, [audio.desktopEnabled])

  return (
    <section className="yt-settings">
      <h3>Audio</h3>

      <label className="audio-row">
        <input type="checkbox" checked={audio.desktopEnabled} aria-label="Desktop audio"
          onChange={(e) => axi().setDesktopEnabled(e.target.checked)} />
        <span>Desktop audio</span>
      </label>

      {audio.desktopEnabled && (() => {
        const stale = staleOption(audio.desktopDevice, outputDevices)
        return (
          <label>Output device
            <select value={audio.desktopDevice ?? ''} onChange={(e) => axi().setDesktopDevice(e.target.value)}>
              {stale && <option value={stale.id}>{stale.name}</option>}
              {outputDevices.length === 0 && !stale && <option value="">No output devices found</option>}
              {outputDevices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        )
      })()}

      <label className="audio-row">
        <input type="checkbox" checked={audio.micEnabled} aria-label="Microphone"
          onChange={(e) => axi().setMicEnabled(e.target.checked)} />
        <span>Microphone</span>
      </label>

      {audio.micEnabled && (() => {
        const stale = staleOption(audio.micDevice, micDevices)
        return (
          <label>Microphone device
            <select value={audio.micDevice ?? ''} onChange={(e) => axi().setMicDevice(e.target.value)}>
              {stale && <option value={stale.id}>{stale.name}</option>}
              {micDevices.length === 0 && !stale && <option value="">No input devices found</option>}
              {micDevices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        )
      })()}
    </section>
  )
}
