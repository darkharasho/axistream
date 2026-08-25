import { describe, it, expect } from 'vitest'
import { placeWebcam } from '../src/main/webcam-layout.js'

// 1920x1080 canvas, 1280x720 camera, 25% width:
//   targetW = 480, scale = 0.375, targetH = 270, margin = 38.4
const BASE = { baseW: 1920, baseH: 1080, srcW: 1280, srcH: 720, sizePct: 0.25, mirrored: false }

describe('placeWebcam', () => {
  it('scales to sizePct of canvas width and preserves aspect', () => {
    const p = placeWebcam({ ...BASE, corner: 'tl' })!
    expect(p.scaleX).toBeCloseTo(0.375)
    expect(p.scaleY).toBeCloseTo(0.375)
  })

  it('places each corner inside its margin', () => {
    expect(placeWebcam({ ...BASE, corner: 'tl' })!).toMatchObject({ positionX: 38.4, positionY: 38.4 })
    expect(placeWebcam({ ...BASE, corner: 'tr' })!.positionX).toBeCloseTo(1401.6)
    expect(placeWebcam({ ...BASE, corner: 'tr' })!.positionY).toBeCloseTo(38.4)
    expect(placeWebcam({ ...BASE, corner: 'bl' })!.positionX).toBeCloseTo(38.4)
    expect(placeWebcam({ ...BASE, corner: 'bl' })!.positionY).toBeCloseTo(771.6)
    expect(placeWebcam({ ...BASE, corner: 'br' })!.positionX).toBeCloseTo(1401.6)
    expect(placeWebcam({ ...BASE, corner: 'br' })!.positionY).toBeCloseTo(771.6)
  })

  // The single most likely defect in the feature: OBS scales a scene item
  // about its origin, so a negative scaleX draws it LEFTWARD from positionX.
  it('offsets positionX by the target width when mirrored so the image does not move', () => {
    const plain = placeWebcam({ ...BASE, corner: 'br' })!
    const mirrored = placeWebcam({ ...BASE, corner: 'br', mirrored: true })!
    expect(mirrored.scaleX).toBeCloseTo(-0.375)
    expect(mirrored.scaleY).toBeCloseTo(0.375)
    // Drawn content still spans the same horizontal band.
    expect(mirrored.positionX - 480).toBeCloseTo(plain.positionX)
    // ...and its right edge still sits one margin from the canvas edge.
    expect(mirrored.positionX).toBeCloseTo(1920 - 38.4)
  })

  it('mirrors the top-left corner without pushing it off-canvas', () => {
    const m = placeWebcam({ ...BASE, corner: 'tl', mirrored: true })!
    expect(m.positionX - 480).toBeCloseTo(38.4)
  })

  it('clamps sizePct to the 0.15-0.35 range', () => {
    expect(placeWebcam({ ...BASE, corner: 'tl', sizePct: 0.9 })!.scaleX).toBeCloseTo(0.35 * 1920 / 1280)
    expect(placeWebcam({ ...BASE, corner: 'tl', sizePct: 0.01 })!.scaleX).toBeCloseTo(0.15 * 1920 / 1280)
  })

  it('returns null when any dimension is missing', () => {
    // A camera reports 0x0 until its first frame arrives; dividing by that
    // would produce Infinity and shove the item off-canvas.
    expect(placeWebcam({ ...BASE, corner: 'tl', srcW: 0 })).toBeNull()
    expect(placeWebcam({ ...BASE, corner: 'tl', srcH: 0 })).toBeNull()
    expect(placeWebcam({ ...BASE, corner: 'tl', baseW: 0 })).toBeNull()
    expect(placeWebcam({ ...BASE, corner: 'tl', baseH: 0 })).toBeNull()
  })
})
