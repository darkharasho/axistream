import { WEBCAM_MIN_SIZE_PCT, WEBCAM_MAX_SIZE_PCT, type WebcamCorner } from '../shared/state.js'

export const WEBCAM_MARGIN_PCT = 0.02

export interface PlaceInput {
  corner: WebcamCorner
  sizePct: number
  mirrored: boolean
  baseW: number
  baseH: number
  srcW: number
  srcH: number
}

export interface Placement {
  positionX: number
  positionY: number
  scaleX: number
  scaleY: number
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// Pure: canvas + source dimensions + corner + size -> an OBS scene-item
// transform. Returns null when any dimension is unusable, which happens for
// real: a camera input reports 0x0 until its first frame arrives.
export function placeWebcam(i: PlaceInput): Placement | null {
  if (!(i.baseW > 0) || !(i.baseH > 0) || !(i.srcW > 0) || !(i.srcH > 0)) return null

  const sizePct = clamp(i.sizePct, WEBCAM_MIN_SIZE_PCT, WEBCAM_MAX_SIZE_PCT)
  const targetW = sizePct * i.baseW
  const scale = targetW / i.srcW
  const targetH = i.srcH * scale
  const margin = WEBCAM_MARGIN_PCT * i.baseW

  const x = i.corner === 'tl' || i.corner === 'bl' ? margin : i.baseW - margin - targetW
  const y = i.corner === 'tl' || i.corner === 'tr' ? margin : i.baseH - margin - targetH

  // OBS scales a scene item about its origin, so a negative scaleX draws the
  // item leftward from positionX. Shift right by one target width to keep the
  // visible image exactly where the un-mirrored image would have been.
  return {
    positionX: i.mirrored ? x + targetW : x,
    positionY: y,
    scaleX: i.mirrored ? -scale : scale,
    scaleY: scale,
  }
}
