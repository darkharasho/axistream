export interface Size { width: number; height: number }

const MAX_ASPECT = 16 / 9

/** Window size = workArea * fraction on both axes, with each axis clamped up
 *  to the min floor — and width additionally capped at 16:9 of the height so
 *  ultrawide monitors don't get a cinema-wide window. Integer-valued; never
 *  throws. */
export function computeWindowSize(workArea: Size, fraction: number, min: Size): Size {
  const height = Math.max(min.height, Math.round(workArea.height * fraction))
  const width = Math.max(min.width, Math.min(Math.round(workArea.width * fraction), Math.round(height * MAX_ASPECT)))
  return { width, height }
}

/** Content width that makes the preview area (window minus sidebar) match
 *  the capture aspect exactly at the current content height. */
export function fitWidthForCapture(sidebarW: number, contentHeight: number, capW: number, capH: number, minW: number, maxW: number): number {
  if (!(capW > 0) || !(capH > 0) || !(contentHeight > 0)) return minW
  return Math.min(maxW, Math.max(minW, Math.round(sidebarW + contentHeight * (capW / capH))))
}
