import { useEffect, useRef, useState } from 'react'
import { RotateCw } from 'lucide-react'
import type { AxiApi, AudioDevice, AppState } from '../../shared/state.js'
import { staleOption } from '../device-options.js'
import { GameAudioSettings } from './GameAudioSettings.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi

export function AudioSettings({ audio, gameAudioPlugin, phase }: { audio: AppState['audio']; gameAudioPlugin: AppState['gameAudioPlugin']; phase: AppState['phase'] }) {
  const [micDevices, setMicDevices] = useState<AudioDevice[] | null>(null)
  const [outputDevices, setOutputDevices] = useState<AudioDevice[] | null>(null)
  const [runningApps, setRunningApps] = useState<AudioDevice[] | null>(null)
  const [appFilter, setAppFilter] = useState('')
  const appsRef = useRef(audio.gameAudioApps)
  const pluginReady = gameAudioPlugin.status === 'ready'

  useEffect(() => {
    if (!audio.micEnabled) return
    axi().getAudioDevices().then(setMicDevices)
  }, [audio.micEnabled])

  useEffect(() => {
    if (!audio.desktopEnabled) return
    axi().getDesktopDevices().then(setOutputDevices)
  }, [audio.desktopEnabled])

  useEffect(() => {
    if (!pluginReady) return
    axi().getGameAudioApps().then(setRunningApps)
  }, [pluginReady])

  useEffect(() => { appsRef.current = audio.gameAudioApps }, [audio.gameAudioApps])

  const refreshApps = () => { axi().getGameAudioApps().then(setRunningApps) }
  const toggleApp = (id: string) => {
    const current = appsRef.current
    const next = current.includes(id)
      ? current.filter((a) => a !== id)
      : [...current, id]
    appsRef.current = next
    void axi().setGameAudioApps(next)
  }
  // Saved selections stay listed (checked) even when not currently running.
  const rows = [
    ...(runningApps ?? []),
    ...audio.gameAudioApps.filter((id) => !(runningApps ?? []).some((r) => r.id === id)).map((id) => ({ id, name: id })),
  ]
  const shownRows = appFilter.trim()
    ? rows.filter((r) => r.name.toLowerCase().includes(appFilter.trim().toLowerCase()))
    : rows
  const isRunning = (id: string) => (runningApps ?? []).some((r) => r.id === id)

  return (
    <section className="yt-settings">
      <h3>Audio</h3>

      <div className="hear-list">
        <label className="hear-row all">
          <input type="checkbox" checked={audio.desktopEnabled} aria-label="All desktop audio"
            onChange={(e) => axi().setDesktopEnabled(e.target.checked)} />
          <span>All desktop audio</span>
          <span className="sub"> — everything your speakers play</span>
        </label>

        {audio.desktopEnabled && (() => {
          const stale = outputDevices ? staleOption(audio.desktopDevice, outputDevices) : null
          return (
            <label className="hear-devrow">Output device
              <select value={audio.desktopDevice ?? ''} onChange={(e) => axi().setDesktopDevice(e.target.value)}>
                {stale && <option value={stale.id}>{stale.name}</option>}
                {outputDevices?.length === 0 && !stale && <option value="">No output devices found</option>}
                {(outputDevices ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )
        })()}

        <div className="hear-divider">
          <span>Only these apps</span>
          <div className="line" />
          {pluginReady && (
            <button className="hear-refresh" title="Refresh running apps" onClick={refreshApps}><RotateCw size={12} /></button>
          )}
        </div>

        {pluginReady ? (
          <>
            <input className="hear-search" type="search" placeholder="Search apps…" aria-label="Search apps"
              value={appFilter} onChange={(e) => setAppFilter(e.target.value)} />
            <div className="hear-apps">
              {shownRows.map((app) => (
                <label key={app.id} className="hear-row">
                  <input type="checkbox" checked={audio.gameAudioApps.includes(app.id)} aria-label={app.name}
                    onChange={() => toggleApp(app.id)} />
                  <span>{app.name}</span>
                  {!isRunning(app.id) && <span className="hear-pill">not running</span>}
                </label>
              ))}
            </div>
          </>
        ) : (
          <div className="hear-install"><GameAudioSettings plugin={gameAudioPlugin} phase={phase} /></div>
        )}
      </div>
      {pluginReady && (
        <p className="muted">Pick your game to keep Discord and music off the stream. Checking an app switches off desktop audio automatically.</p>
      )}

      <label className="audio-row">
        <input type="checkbox" checked={audio.micEnabled} aria-label="Microphone"
          onChange={(e) => axi().setMicEnabled(e.target.checked)} />
        <span>Microphone</span>
      </label>

      {audio.micEnabled && (() => {
        const stale = micDevices ? staleOption(audio.micDevice, micDevices) : null
        return (
          <label>Microphone device
            <select value={audio.micDevice ?? ''} onChange={(e) => axi().setMicDevice(e.target.value)}>
              {stale && <option value={stale.id}>{stale.name}</option>}
              {micDevices?.length === 0 && !stale && <option value="">No input devices found</option>}
              {(micDevices ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        )
      })()}
    </section>
  )
}
