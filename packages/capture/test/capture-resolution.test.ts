import { describe, it, expect, vi } from 'vitest'
import { fitOutputResolution, applyCaptureResolution, type ResolutionDeps } from '../src/capture-resolution.js'

describe('fitOutputResolution', () => {
  it('returns native dims when height is at or below the cap', () => {
    expect(fitOutputResolution(1920, 1080, 1440)).toEqual({ width: 1920, height: 1080 })
    expect(fitOutputResolution(2560, 1440, 1440)).toEqual({ width: 2560, height: 1440 })
  })

  it('keeps an ultrawide at full width when height is within the cap (no crop)', () => {
    expect(fitOutputResolution(3440, 1440, 1440)).toEqual({ width: 3440, height: 1440 })
  })

  it('downscales 4K 16:9 to 1440p height', () => {
    expect(fitOutputResolution(3840, 2160, 1440)).toEqual({ width: 2560, height: 1440 })
  })

  it('downscales 5K2K ultrawide preserving aspect, even-rounded', () => {
    // 5120 * (1440/2160) = 3413.33 -> floor-even 3412
    expect(fitOutputResolution(5120, 2160, 1440)).toEqual({ width: 3412, height: 1440 })
  })

  it('rounds odd native dimensions down to even', () => {
    expect(fitOutputResolution(1921, 1081, 1440)).toEqual({ width: 1920, height: 1080 })
  })

  it('returns null for non-positive or non-finite dimensions', () => {
    expect(fitOutputResolution(0, 1080, 1440)).toBeNull()
    expect(fitOutputResolution(1920, -1, 1440)).toBeNull()
    expect(fitOutputResolution(NaN, 1080, 1440)).toBeNull()
    expect(fitOutputResolution(1920, Infinity, 1440)).toBeNull()
  })
})

describe('applyCaptureResolution', () => {
  function makeCall(transform: { sourceWidth: number; sourceHeight: number }) {
    return vi.fn(async (req: string) => {
      if (req === 'GetSceneItemId') return { sceneItemId: 7 }
      if (req === 'GetSceneItemTransform') return { sceneItemTransform: transform }
      if (req === 'SetVideoSettings') return {}
      throw new Error(`unexpected request ${req}`)
    })
  }

  it('reads source dims and applies base + fitted output via SetVideoSettings', async () => {
    const call = makeCall({ sourceWidth: 3440, sourceHeight: 1440 })
    const res = await applyCaptureResolution({ call: call as unknown as ResolutionDeps['call'] })
    expect(res).toEqual({ baseWidth: 3440, baseHeight: 1440, outputWidth: 3440, outputHeight: 1440, fps: 60 })
    expect(call).toHaveBeenCalledWith('GetSceneItemId', { sceneName: 'Main', sourceName: 'AxiStream Capture' })
    expect(call).toHaveBeenCalledWith('SetVideoSettings', {
      baseWidth: 3440, baseHeight: 1440, outputWidth: 3440, outputHeight: 1440,
      fpsNumerator: 60, fpsDenominator: 1,
    })
  })

  it('downscales a 4K source for the output but keeps base at native', async () => {
    const call = makeCall({ sourceWidth: 3840, sourceHeight: 2160 })
    const res = await applyCaptureResolution({ call: call as unknown as ResolutionDeps['call'] })
    expect(res).toEqual({ baseWidth: 3840, baseHeight: 2160, outputWidth: 2560, outputHeight: 1440, fps: 60 })
  })

  it('returns null and does NOT call SetVideoSettings when dims are unreadable', async () => {
    const call = makeCall({ sourceWidth: 0, sourceHeight: 0 })
    const res = await applyCaptureResolution({ call: call as unknown as ResolutionDeps['call'] })
    expect(res).toBeNull()
    expect(call).not.toHaveBeenCalledWith('SetVideoSettings', expect.anything())
  })

  it('returns null and never throws when a call rejects', async () => {
    const call = vi.fn(async () => { throw new Error('not connected') })
    await expect(applyCaptureResolution({ call })).resolves.toBeNull()
  })
})

describe('applyCaptureResolution quality deps', () => {
  const client = (sourceWidth: number, sourceHeight: number) => {
    const calls: { req: string; params?: object }[] = []
    const call = vi.fn(async (req: string, params?: object) => {
      calls.push({ req, params })
      if (req === 'GetSceneItemId') return { sceneItemId: 7 }
      if (req === 'GetSceneItemTransform') return { sceneItemTransform: { sourceWidth, sourceHeight } }
      return {}
    })
    return { call: call as unknown as ResolutionDeps['call'], calls }
  }

  it('caps the output at a supplied maxHeight and uses the supplied fps', async () => {
    const c = client(3840, 2160)

    const r = await applyCaptureResolution({ call: c.call, maxHeight: 720, fps: 30 })

    expect(r).toEqual({ baseWidth: 3840, baseHeight: 2160, outputWidth: 1280, outputHeight: 720, fps: 30 })
    const set = c.calls.find((x) => x.req === 'SetVideoSettings')
    expect(set?.params).toMatchObject({
      baseWidth: 3840, baseHeight: 2160,
      outputWidth: 1280, outputHeight: 720,
      fpsNumerator: 30, fpsDenominator: 1,
    })
  })

  it('defaults to a 1440 cap at 60fps when the deps are omitted', async () => {
    const c = client(3840, 2160)

    const r = await applyCaptureResolution({ call: c.call })

    expect(r).toMatchObject({ outputWidth: 2560, outputHeight: 1440, fps: 60 })
  })

  it('never upscales past the monitor even when maxHeight is higher', async () => {
    const c = client(1920, 1080)

    const r = await applyCaptureResolution({ call: c.call, maxHeight: 1440, fps: 60 })

    expect(r).toMatchObject({ outputWidth: 1920, outputHeight: 1080 })
  })
})
