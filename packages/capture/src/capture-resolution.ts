export interface OutputResolution { width: number; height: number }

function isPos(n: number): boolean { return Number.isFinite(n) && n > 0 }
function even(n: number): number { return Math.max(2, Math.floor(n / 2) * 2) }

/** Scale (w,h) so height <= maxHeight, preserving aspect ratio; never upscale.
 *  Output dims are rounded down to the nearest even number (encoders require
 *  even width & height). Returns null if w or h is not a positive finite number. */
export function fitOutputResolution(w: number, h: number, maxHeight: number): OutputResolution | null {
  if (!isPos(w) || !isPos(h)) return null
  if (h <= maxHeight) return { width: even(w), height: even(h) }
  const f = maxHeight / h
  return { width: even(w * f), height: even(maxHeight) }
}

export interface CaptureResolution {
  baseWidth: number; baseHeight: number
  outputWidth: number; outputHeight: number
  fps: number
}

export interface ResolutionDeps {
  call: <T = unknown>(req: string, params?: object) => Promise<T>
  sceneName?: string
  sourceName?: string
  maxHeight?: number
  fps?: number
}

/** Read the captured monitor's native size from OBS, compute the output
 *  resolution, and apply both to OBS via SetVideoSettings. Returns the applied
 *  CaptureResolution, or null if dims are unreadable (capture not yet rendering)
 *  or any call fails — caller leaves OBS untouched and keeps going. Never throws. */
export async function applyCaptureResolution(deps: ResolutionDeps): Promise<CaptureResolution | null> {
  const sceneName = deps.sceneName ?? 'Main'
  const sourceName = deps.sourceName ?? 'AxiStream Capture'
  const maxHeight = deps.maxHeight ?? 1440
  const fps = deps.fps ?? 60
  try {
    const { sceneItemId } = await deps.call<{ sceneItemId: number }>('GetSceneItemId', { sceneName, sourceName })
    const { sceneItemTransform } = await deps.call<{ sceneItemTransform: { sourceWidth: number; sourceHeight: number } }>(
      'GetSceneItemTransform', { sceneName, sceneItemId },
    )
    const baseWidth = Math.round(sceneItemTransform?.sourceWidth ?? 0)
    const baseHeight = Math.round(sceneItemTransform?.sourceHeight ?? 0)
    const out = fitOutputResolution(baseWidth, baseHeight, maxHeight)
    if (!out) return null
    await deps.call('SetVideoSettings', {
      baseWidth, baseHeight,
      outputWidth: out.width, outputHeight: out.height,
      fpsNumerator: fps, fpsDenominator: 1,
    })
    return { baseWidth, baseHeight, outputWidth: out.width, outputHeight: out.height, fps }
  } catch {
    return null
  }
}
