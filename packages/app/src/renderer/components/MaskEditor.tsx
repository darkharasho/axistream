import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { MAX_MASKS, type MaskRect, type AppState } from '../../shared/state.js'
import { coverContentRect, type CoverRect } from '../cover-transform.js'

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const newId = () => Math.random().toString(36).slice(2, 10)

interface Drag { id: string; mode: 'move' | 'resize'; px: number; py: number; orig: MaskRect }

// Edit overlay for privacy masks. Coordinates are normalized (0–1) against
// the OBS canvas; the sibling preview <video> shows that canvas under
// object-fit: cover, so we map through its content rect to line up on screen.
// Local state is authoritative while editing; every add/delete/drag-end
// commits the full array upward (which persists + drives OBS live).
export function MaskEditor({ masks: initial, onCommit, onDone, maskStyle, blurPlugin, onSetStyle, onInstallBlur, onRelaunch }: {
  masks: MaskRect[]
  onCommit(masks: MaskRect[]): void
  onDone(): void
  maskStyle: 'box' | 'blur'
  blurPlugin: AppState['blurPlugin']
  onSetStyle(style: 'box' | 'blur'): void
  onInstallBlur(): void
  onRelaunch(): void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [masks, setMasks] = useState<MaskRect[]>(initial)
  // Ref mirror so pointer-up commits the exact rects of the final move event,
  // not a possibly-stale render closure.
  const masksRef = useRef(masks)
  const update = (next: MaskRect[]) => { masksRef.current = next; setMasks(next) }
  const [drag, setDrag] = useState<Drag | null>(null)
  const [content, setContent] = useState<CoverRect | null>(null)
  const [blurPrompt, setBlurPrompt] = useState(false)

  useEffect(() => {
    const measure = () => {
      const el = boxRef.current
      if (!el) return
      const video = el.parentElement?.querySelector('video')
      setContent(coverContentRect(video?.videoWidth ?? 0, video?.videoHeight ?? 0, el.clientWidth, el.clientHeight))
    }
    measure()
    window.addEventListener('resize', measure)
    // The video's dimensions only exist once the virtual-cam feed is up, and
    // can change after an OBS restart — re-measure on a slow tick.
    const t = setInterval(measure, 1000)
    return () => { window.removeEventListener('resize', measure); clearInterval(t) }
  }, [])

  const rect = content ?? { left: 0, top: 0, width: 1, height: 1 }
  const commit = (next: MaskRect[]) => { update(next); onCommit(next) }

  const add = () => commit([...masksRef.current, { id: newId(), x: 0.375, y: 0.4, w: 0.25, h: 0.2 }])
  const remove = (id: string) => commit(masksRef.current.filter((m) => m.id !== id))

  const onPointerDown = (e: React.PointerEvent, id: string, mode: Drag['mode']) => {
    e.preventDefault(); e.stopPropagation()
    const orig = masks.find((m) => m.id === id)
    if (!orig) return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setDrag({ id, mode, px: e.clientX, py: e.clientY, orig })
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || !rect.width || !rect.height) return
    const dx = (e.clientX - drag.px) / rect.width
    const dy = (e.clientY - drag.py) / rect.height
    update(masksRef.current.map((m) => {
      if (m.id !== drag.id) return m
      if (drag.mode === 'move') {
        return { ...m, x: clamp(drag.orig.x + dx, 0, 1 - m.w), y: clamp(drag.orig.y + dy, 0, 1 - m.h) }
      }
      return { ...m, w: clamp(drag.orig.w + dx, 0.01, 1 - m.x), h: clamp(drag.orig.h + dy, 0.01, 1 - m.y) }
    }))
  }
  const onPointerUp = () => {
    if (!drag) return
    setDrag(null)
    onCommit(masksRef.current)
  }

  return (
    <div ref={boxRef} className="mask-editor" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div className="mask-toolbar">
        <button className="btn ghost xs" onClick={add} disabled={masks.length >= MAX_MASKS}><Plus size={12} /> Add mask</button>
        <div className="mask-style" role="group" aria-label="Mask style">
          <button className={`mask-style-btn${maskStyle === 'box' ? ' on' : ''}`} onClick={() => { setBlurPrompt(false); onSetStyle('box') }}>Solid</button>
          <button className={`mask-style-btn${maskStyle === 'blur' ? ' on' : ''}`}
            onClick={() => { if (blurPlugin.status === 'ready') { setBlurPrompt(false); onSetStyle('blur') } else setBlurPrompt(true) }}>Blur</button>
        </div>
        <span className="mask-hint">Drag to move · corner to resize · masks hide these areas on stream</span>
        <button className="btn primary xs" onClick={onDone}>Done</button>
      </div>
      {blurPrompt && blurPlugin.status !== 'ready' && (
        <div className="mask-blur-prompt">
          {blurPlugin.status === 'missing' && <button className="btn ghost xs" onClick={onInstallBlur}>Install blur plugin</button>}
          {blurPlugin.status === 'installing' && <span>Installing…</span>}
          {blurPlugin.status === 'installed' && <button className="btn ghost xs" onClick={onRelaunch}>Restart AxiStream</button>}
          {blurPlugin.status === 'error' && <button className="btn ghost xs" onClick={onInstallBlur}>Retry install</button>}
          {blurPlugin.status === 'unsupported' && <span>Blur needs the OBS flatpak.</span>}
        </div>
      )}
      {masks.map((m) => (
        <div key={m.id} data-testid="mask-rect" className="mask-rect"
          style={{ left: rect.left + m.x * rect.width, top: rect.top + m.y * rect.height, width: m.w * rect.width, height: m.h * rect.height }}
          onPointerDown={(e) => onPointerDown(e, m.id, 'move')}>
          <button className="mask-delete" aria-label="Delete mask" onPointerDown={(e) => e.stopPropagation()} onClick={() => remove(m.id)}><X size={11} /></button>
          <div className="mask-resize" onPointerDown={(e) => onPointerDown(e, m.id, 'resize')} />
        </div>
      ))}
    </div>
  )
}
