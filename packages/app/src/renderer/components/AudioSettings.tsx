import { useEffect, useRef, useState } from 'react'
import { RotateCw } from 'lucide-react'
import type { AxiApi, AudioDevice, AppState, AudioLevels } from '../../shared/state.js'
import { staleOption } from '../device-options.js'
import { GameAudioSettings } from './GameAudioSettings.js'
import { AudioPulse } from './AudioPulse.js'
import { PTT_KEY_CHOICES } from '../../shared/keys.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi

export function AudioSettings({ audio, gameAudioPlugin, phase, ptt }: { audio: AppState['audio']; gameAudioPlugin: AppState['gameAudioPlugin']; phase: AppState['phase']; ptt: AppState['ptt'] }) {
  const [test, setTest] = useState<{ st: 'idle' | 'recording' | 'ready' | 'error'; url?: string; error?: string; left?: number }>({ st: 'idle' })
  const [pttEnabled, setPttEnabledLocal] = useState(ptt.enabled)
  const [unlockErr, setUnlockErr] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  // Resync on OBJECT identity, not value: main pushes a fresh ptt object on
  // every setPttEnabled result, so a FAILED enable (enabled stays false)
  // still fires this and corrects the optimistic checkbox.
  useEffect(() => { setPttEnabledLocal(ptt.enabled) }, [ptt])
  const canTest = phase === 'READY' || phase === 'NEEDS_KEY' || phase === 'NEEDS_TITLE'

  const runTest = async () => {
    if (test.url) URL.revokeObjectURL(test.url)
    setTest({ st: 'recording', left: 6 })
    const tick = setInterval(() => setTest((t) => (t.st === 'recording' ? { ...t, left: Math.max(0, (t.left ?? 0) - 1) } : t)), 1000)
    const r = await axi().recordAudioTest()
    clearInterval(tick)
    if (r.ok && r.clip) {
      const url = URL.createObjectURL(new Blob([r.clip as BlobPart], { type: r.mime ?? 'video/mp4' }))
      setTest({ st: 'ready', url })
    } else {
      setTest({ st: 'error', error: r.error ?? 'Test failed' })
    }
  }

  const unlock = async () => {
    setUnlockErr(null)
    const r = await axi().unlockPassthrough()
    if (!r.ok) setUnlockErr(r.error ?? 'Unlock failed')
  }

  const rebind = async () => {
    setCapturing(true)
    try { await axi().capturePttKey() } finally { setCapturing(false) }
  }

  const [micDevices, setMicDevices] = useState<AudioDevice[] | null>(null)
  const [outputDevices, setOutputDevices] = useState<AudioDevice[] | null>(null)
  const [runningApps, setRunningApps] = useState<AudioDevice[] | null>(null)
  const [appFilter, setAppFilter] = useState('')
  const [levels, setLevels] = useState<AudioLevels>({ desktop: 0, mic: 0, game: 0 })
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
  useEffect(() => axi().onAudioLevels(setLevels), [])

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
  // Selected apps float to the top so what's on-stream is always visible first;
  // order within each group is preserved (running before saved-not-running).
  const ordered = [
    ...rows.filter((r) => audio.gameAudioApps.includes(r.id)),
    ...rows.filter((r) => !audio.gameAudioApps.includes(r.id)),
  ]
  const shownRows = appFilter.trim()
    ? ordered.filter((r) => r.name.toLowerCase().includes(appFilter.trim().toLowerCase()))
    : ordered
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
          <AudioPulse level={levels.desktop} />
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
          <AudioPulse level={levels.game} />
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
        <AudioPulse level={levels.mic} />
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

      {audio.micEnabled && (
        <div className="ptt">
          <label className="audio-row">
            <input type="checkbox" checked={pttEnabled} disabled={!ptt.available} aria-label={`Push to talk (hold ${ptt.keyName})`}
              onChange={(e) => { setPttEnabledLocal(e.target.checked); axi().setPttEnabled(e.target.checked) }} />
            <span>Push to talk (hold {ptt.keyName})</span>
            {pttEnabled && (ptt.active
              ? <span className="ptt-live">🔴 TRANSMITTING</span>
              : <span className="ptt-muted">muted — hold {ptt.keyName} to talk</span>)}
          </label>
          {!ptt.available && <p className="muted">Needs the GlobalShortcuts portal — available on KDE Plasma</p>}
          {ptt.error && <p className="ptt-err">{ptt.error}</p>}
          {ptt.enabled && ptt.mode === 'passthrough' && (
            <>
              <p className="muted">Key events pass through — Discord's own push-to-talk works alongside.</p>
              {capturing ? <span className="muted">Press any key… (Esc to cancel)</span> : <button className="btn ghost xs" onClick={rebind}>Rebind</button>}
            </>
          )}
          {ptt.enabled && ptt.mode === 'exclusive' && (
            <>
              <p className="muted">AxiStream owns the key — Discord won't see {ptt.keyName}.</p>
              <button className="btn ghost xs" onClick={unlock}>Enable pass-through (asks for your admin password)</button>
              <p className="muted">Grants apps in your session read access to input devices (required for pass-through).</p>
              {unlockErr && <p className="ptt-err">{unlockErr}</p>}
              <label className="muted">Push-to-talk key
                <select value={String(PTT_KEY_CHOICES.find((k) => k.name === ptt.keyName)?.code ?? 188)}
                  onChange={(e) => { const k = PTT_KEY_CHOICES.find((c) => c.code === Number(e.target.value)); if (k) axi().setPttKey(k) }}>
                  {PTT_KEY_CHOICES.map((k) => <option key={k.code} value={k.code}>{k.name}</option>)}
                </select>
              </label>
              <p className="muted">Binding again may show a KDE confirmation.</p>
            </>
          )}
          {pttEnabled && (
            <p className="muted">AxiStream mutes your mic at the system level and unmutes it while the key is held. Set Discord to <strong>Voice Activity</strong> (not Push to Talk) — it follows automatically.</p>
          )}
        </div>
      )}

      <div className="audio-test">
        <button className="btn ghost sm" disabled={!canTest || test.st === 'recording'} onClick={runTest}>
          {test.st === 'recording' ? `Recording — speak now… ${test.left}` : 'Test audio'}
        </button>
        {test.st === 'ready' && test.url && (
          <audio data-testid="audio-test-player" controls src={test.url}
            onError={() => setTest({ st: 'error', error: "Couldn't play the clip — the recording may be corrupt or blocked" })} />
        )}
        {test.st === 'error' && <span className="audio-test-err">{test.error}</span>}
        <p className="muted">Records 6 seconds of your actual stream output — speak, and check your game is audible.{pttEnabled ? ` Hold ${ptt.keyName} while recording to test your mic.` : null}</p>
      </div>
    </section>
  )
}
