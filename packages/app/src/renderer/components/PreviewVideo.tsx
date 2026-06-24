import { useEffect, useRef } from 'react'

// Live preview of OBS's output via its Virtual Camera (v4l2loopback). Real-time,
// GPU-decoded, and reflects OBS's composited feed (so privacy masks show later).
//
// The virtual-cam device disappears and reappears whenever OBS restarts (e.g.
// switching the capture source rebuilds the scene and bounces OBS). So we don't
// acquire once — we re-acquire whenever the track ends or the device list
// changes, which keeps the preview from going black until an app restart.
export function PreviewVideo() {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md?.enumerateDevices || !md.getUserMedia) return // jsdom / unsupported
    let stream: MediaStream | null = null
    let cancelled = false
    let retimer: ReturnType<typeof setTimeout> | null = null

    const stop = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null }
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
            stream.getVideoTracks()[0]?.addEventListener('ended', () => schedule())
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
    void acquire()
    return () => {
      cancelled = true
      if (retimer) clearTimeout(retimer)
      md.removeEventListener?.('devicechange', onDeviceChange)
      stop()
    }
  }, [])
  return <video ref={ref} className="preview-video" autoPlay muted playsInline />
}
