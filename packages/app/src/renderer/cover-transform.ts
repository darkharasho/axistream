export interface CoverRect { left: number; top: number; width: number; height: number }

/** Element-pixel rect a video occupies under object-fit: contain — always
 *  inside the element (letterbox/pillarbox bars are the remainder). */
export function containContentRect(videoW: number, videoH: number, elemW: number, elemH: number): CoverRect {
  if (!(videoW > 0) || !(videoH > 0) || !(elemW > 0) || !(elemH > 0)) return { left: 0, top: 0, width: elemW, height: elemH }
  const scale = Math.min(elemW / videoW, elemH / videoH)
  const width = videoW * scale
  const height = videoH * scale
  return { left: (elemW - width) / 2, top: (elemH - height) / 2, width, height }
}
