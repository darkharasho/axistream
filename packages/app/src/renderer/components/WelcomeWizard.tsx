import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import type { AppState, AudioDevice, AxiApi } from '../../shared/state.js'
import { useModalKeys } from '../use-modal-keys.js'

const STEPS = ['Capture', 'YouTube', 'Microphone', 'Ready'] as const

export function WelcomeWizard({ state, axi, onClose }: { state: AppState; axi: AxiApi; onClose: () => void }) {
  const [step, setStep] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  useModalKeys(ref, onClose)

  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [test, setTest] = useState<{ st: 'idle' | 'recording' | 'ready' | 'error'; url?: string; error?: string }>({ st: 'idle' })
  useEffect(() => { void axi.getAudioDevices().then(setDevices).catch(() => setDevices([])) }, [])

  const capture = state.capture
  const connected = state.youtube.connected

  // Only the capture step gates. YouTube and the mic check are skippable —
  // a stream key set later in Settings is a legitimate path, and a user who
  // knows their mic works should not have to prove it.
  const canAdvance = step !== 0 || capture !== null

  const runMicTest = async () => {
    setTest({ st: 'recording' })
    try {
      const r = await axi.recordAudioTest()
      if (r.ok && r.clip) setTest({ st: 'ready', url: URL.createObjectURL(new Blob([r.clip as BlobPart], { type: r.mime ?? 'audio/mp4' })) })
      else setTest({ st: 'error', error: r.error ?? 'Test failed' })
    } catch (err) {
      // Best-effort like every other OBS/device call — a rejection must not
      // strand the UI on "Recording — speak now…" forever.
      setTest({ st: 'error', error: err instanceof Error ? err.message : 'Test failed' })
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal wizard" ref={ref} role="dialog" aria-modal="true" aria-label="Set up AxiStream">
        <div className="wizard-head">
          <h3>{STEPS[step]}</h3>
          <button className="welcome-x" aria-label="Close" onClick={onClose}><X size={13} /></button>
        </div>
        <ol className="wizard-dots">
          {STEPS.map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''} />)}
        </ol>

        {step === 0 ? (
          <div className="wizard-body">
            <p className="muted">AxiStream captures one screen or window — the one showing your game.</p>
            {capture
              ? <p className="wizard-ok"><Check size={14} /> Capturing {capture.sourceLabel}</p>
              : <button className="btn primary sm" onClick={() => void axi.provision()}>Choose what to capture</button>}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="wizard-body">
            <p className="muted">Connecting YouTube lets AxiStream create the broadcast for you — no stream key to copy.</p>
            {connected
              ? <p className="wizard-ok"><Check size={14} /> Connected as {state.youtube.channel}</p>
              : <button className="btn primary sm" onClick={() => void axi.connectYouTube()}>Connect YouTube</button>}
            <p className="muted">You can skip this and paste a stream key in Settings instead.</p>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="wizard-body">
            <p className="muted">Hear yourself before a stranger does.</p>
            <label>
              <span>Microphone</span>
              <select value={state.audio.micDevice ?? ''} onChange={(e) => {
                void axi.setMicEnabled(true)
                void axi.setMicDevice(e.target.value)
              }}>
                <option value="">Choose a microphone…</option>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <button className="btn ghost sm" disabled={test.st === 'recording'} onClick={() => void runMicTest()}>
              {test.st === 'recording' ? <><Loader2 size={13} className="spin" /> Recording — speak now…</> : 'Test my mic'}
            </button>
            {test.st === 'ready' && test.url ? <audio controls autoPlay src={test.url} /> : null}
            {test.st === 'error' ? <p className="field-err" role="alert">{test.error}</p> : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="wizard-body">
            <p className="wizard-ok">{capture ? <Check size={14} /> : null} Capture — {capture ? capture.sourceLabel : 'not set up'}</p>
            <p className="wizard-ok">{connected ? <Check size={14} /> : null} YouTube — {connected ? state.youtube.channel : 'using a stream key'}</p>
            <p className="wizard-ok">{test.st === 'ready' ? <Check size={14} /> : null} Microphone — {test.st === 'ready' ? 'tested' : 'not tested'}</p>
            <p className="muted">Everything here can be changed later in Settings.</p>
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="btn ghost sm" onClick={onClose}>Skip setup</button>
          <span className="spacer" />
          <button className="btn ghost sm" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</button>
          {step === STEPS.length - 1
            ? <button className="btn primary sm" onClick={onClose}>Go live</button>
            : <button className="btn primary sm" disabled={!canAdvance} onClick={() => setStep((s) => s + 1)}>Next</button>}
        </div>
      </div>
    </div>
  )
}
