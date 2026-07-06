export interface CoverRect { left: number; top: number; width: number; height: number }

/** Element-pixel rect that a video's content occupies under object-fit: cover.
 *  May extend beyond the element (negative left/top) — that's the crop. */
export function coverContentRect(videoW: number, videoH: number, elemW: number, elemH: number): CoverRect {
  if (!(videoW > 0) || !(videoH > 0) || !(elemW > 0) || !(elemH > 0)) return { left: 0, top: 0, width: elemW, height: elemH }
  const scale = Math.max(elemW / videoW, elemH / videoH)
  const width = videoW * scale
  const height = videoH * scale
  return { left: (elemW - width) / 2, top: (elemH - height) / 2, width, height }
}
