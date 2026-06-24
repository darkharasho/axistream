import { useEffect, useRef, useState } from 'react'
import type { AxiApi } from '../../shared/state.js'

const axi = (globalThis as unknown as { axi?: AxiApi }).axi

// Live preview of OBS's output via its Virtual Camera (v4l2loopback). Real-time,
// GPU-decoded, and reflects OBS's composited feed (so privacy masks show later).
//
// The virtual-cam device disappears and reappears whenever OBS restarts (e.g.
// switching the capture source rebuilds the scene and bounces OBS). So we don't
// acquire once — we re-acquire whenever the track ends or the device list
// changes, which keeps the preview from going black until an app restart.
export function PreviewVideo() {
  const ref = useRef<HTMLVideoElement>(null)
  // Fade the video out whenever it isn't actively showing frames (startup, a
  // source switch, an OBS restart) so the hero's colored gradient shows through
  // instead of a black rectangle.
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md?.enumerateDevices || !md.getUserMedia) return // jsdom / unsupported
    let stream: MediaStream | null = null
    let cancelled = false
    let retimer: ReturnType<typeof setTimeout> | null = null

    const stop = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; setPlaying(false) }
    const findCam = async (): Promise<MediaDeviceInfo | null> => {
      const devices = await md.enumerateDevices()
      return devices.find((d) => d.kind === 'videoinput' && /obs|virtual/i.test(d.label)) ?? null
    }

    const schedule = (delay = 400) => {
      if (cancelled) return
      if (retimer) clearTimeout(retimer)
      retimer = setTimeout(() => { void acquire() }, delay)
    }

    const acquire = async (): Promise<void> => {
      if (cancelled) return
      // Unlock device labels (enumerateDevices hides labels until a getUserMedia
      // grant), then release that throwaway stream.
      try { const s = await md.getUserMedia({ video: true }); s.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
      // OBS's virtual cam may take a moment to (re)register; retry briefly.
      for (let i = 0; i < 30 && !cancelled; i++) {
        const cam = await findCam()
        if (cam) {
          try {
            stop()
            stream = await md.getUserMedia({ video: { deviceId: { exact: cam.deviceId } } })
            if (cancelled) { stop(); return }
            if (ref.current) { ref.current.srcObject = stream; void ref.current.play().catch(() => {}) }
            // When OBS restarts, this track ends — re-acquire the new device.
            stream.getVideoTracks()[0]?.addEventListener('ended', () => { setPlaying(false); schedule() })
            return
          } catch { /* device may be mid-restart; fall through to retry */ }
        }
        await new Promise((r) => setTimeout(r, 600))
      }
      // Cam not back yet (e.g. OBS still restarting) — try again shortly.
      schedule(1500)
    }

    const onDeviceChange = () => schedule()
    md.addEventListener?.('devicechange', onDeviceChange)
    // The main process signals when it (re)starts the virtual cam after an OBS
    // restart. Give the cam a beat to start producing frames, then re-acquire —
    // this is the reliable recovery path when the v4l2 device freezes black.
    const offCaptureChanged = axi?.onCaptureChanged(() => { setPlaying(false); schedule(900) })
    void acquire()
    return () => {
      cancelled = true
      if (retimer) clearTimeout(retimer)
      md.removeEventListener?.('devicechange', onDeviceChange)
      offCaptureChanged?.()
      stop()
    }
  }, [])
  return <video ref={ref} className={`preview-video${playing ? '' : ' loading'}`} autoPlay muted playsInline onPlaying={() => setPlaying(true)} />
}
