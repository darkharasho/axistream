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
