export interface Size { width: number; height: number }

/** Window size = workArea * fraction on both axes (preserving aspect ratio),
 *  with each axis clamped up to the min floor. Integer-valued; never throws. */
export function computeWindowSize(workArea: Size, fraction: number, min: Size): Size {
  return {
    width: Math.max(min.width, Math.round(workArea.width * fraction)),
    height: Math.max(min.height, Math.round(workArea.height * fraction)),
  }
}
