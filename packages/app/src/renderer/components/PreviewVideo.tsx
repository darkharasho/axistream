import { useEffect, useRef } from 'react'

// Live preview of OBS's output via its Virtual Camera (v4l2loopback). Real-time,
// GPU-decoded, and reflects OBS's composited feed (so privacy masks show later).
export function PreviewVideo() {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md?.enumerateDevices || !md.getUserMedia) return // jsdom / unsupported
    let stream: MediaStream | null = null
    let cancelled = false

    const findCam = async (): Promise<MediaDeviceInfo | null> => {
      const devices = await md.enumerateDevices()
      return devices.find((d) => d.kind === 'videoinput' && /obs|virtual/i.test(d.label)) ?? null
    }

    const run = async () => {
      // Unlock device labels (enumerateDevices hides labels until a getUserMedia
      // grant), then release that throwaway stream.
      try { const s = await md.getUserMedia({ video: true }); s.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
      // OBS's virtual cam may take a moment to register; retry.
      for (let i = 0; i < 30 && !cancelled; i++) {
        const cam = await findCam()
        if (cam) {
          try {
            stream = await md.getUserMedia({ video: { deviceId: { exact: cam.deviceId } } })
            if (!cancelled && ref.current) { ref.current.srcObject = stream; void ref.current.play().catch(() => {}) }
          } catch { /* ignore */ }
          return
        }
        await new Promise((r) => setTimeout(r, 600))
      }
    }
    void run()
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()) }
  }, [])
  return <video ref={ref} className="preview-video" autoPlay muted playsInline />
}
