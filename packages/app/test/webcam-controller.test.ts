import { describe, it, expect, vi } from 'vitest'
import { WebcamController, WEBCAM_INPUT, kindsFor } from '../src/main/WebcamController.js'
import { DEFAULT_WEBCAM, type WebcamConfig } from '../src/shared/state.js'

const CANVAS = { baseWidth: 1920, baseHeight: 1080 }

function recorder(opts: {
  inputs?: string[]
  devices?: { itemName: string; itemValue: string }[]
  failGetItem?: boolean
  sourceDims?: { w: number; h: number }[]
} = {}) {
  const calls: { req: string; data: any }[] = []
  const dims = [...(opts.sourceDims ?? [{ w: 1280, h: 720 }])]
  const client = () => ({
    call: vi.fn(async (req: string, data?: any) => {
      calls.push({ req, data })
      if (req === 'GetVideoSettings') return CANVAS
      if (req === 'GetInputList') return { inputs: (opts.inputs ?? []).map((inputName) => ({ inputName })) }
      if (req === 'GetInputPropertiesListPropertyItems') {
        return { propertyItems: opts.devices ?? [{ itemName: 'C920', itemValue: '/dev/video0' }] }
      }
      if (req === 'GetSceneItemId') {
        if (opts.failGetItem) throw new Error('not in scene')
        return { sceneItemId: 7 }
      }
      if (req === 'CreateSceneItem') return { sceneItemId: 7 }
      if (req === 'GetSceneItemTransform') {
        const d = dims.length > 1 ? dims.shift()! : dims[0]
        return { sceneItemTransform: { sourceWidth: d.w, sourceHeight: d.h } }
      }
      return {}
    }),
  })
  return { calls, client }
}

const cfg = (p: Partial<WebcamConfig> = {}): WebcamConfig =>
  ({ ...DEFAULT_WEBCAM, enabled: true, deviceId: '/dev/video0', ...p })

const sleep = () => Promise.resolve()

describe('kindsFor', () => {
  it('maps each platform to its OBS input kind and device property', () => {
    expect(kindsFor('linux')).toEqual({ kind: 'v4l2_input', deviceProp: 'device_id' })
    expect(kindsFor('win32')).toEqual({ kind: 'dshow_input', deviceProp: 'video_device_id' })
    expect(kindsFor('darwin').kind).toBe('v4l2_input')
  })
})

describe('WebcamController.apply', () => {
  it('creates the input then sets the device on it', async () => {
    const r = recorder()
    const res = await new WebcamController({ client: r.client, platform: 'linux', sleep }).apply(cfg())
    expect(res.available).toBe(true)
    const create = r.calls.find((c) => c.req === 'CreateInput')
    expect(create?.data).toMatchObject({ sceneName: 'Main', inputName: WEBCAM_INPUT, inputKind: 'v4l2_input' })
    const set = r.calls.find((c) => c.req === 'SetInputSettings')
    expect(set?.data.inputSettings).toMatchObject({ device_id: '/dev/video0', res_type: 0 })
  })

  it('enumerates devices only after the input exists', async () => {
    const r = recorder()
    await new WebcamController({ client: r.client, platform: 'linux', sleep }).apply(cfg())
    const created = r.calls.findIndex((c) => c.req === 'CreateInput')
    const enumerated = r.calls.findIndex((c) => c.req === 'GetInputPropertiesListPropertyItems')
    expect(created).toBeGreaterThanOrEqual(0)
    expect(enumerated).toBeGreaterThan(created)
  })

  it('re-adds the scene item after a rebuild destroyed it', async () => {
    const r = recorder({ inputs: [WEBCAM_INPUT], failGetItem: true })
    await new WebcamController({ client: r.client, platform: 'linux', sleep }).apply(cfg())
    expect(r.calls.some((c) => c.req === 'CreateSceneItem' && c.data.sourceName === WEBCAM_INPUT)).toBe(true)
  })

  it('pins the item to the top so masks cannot cover it', async () => {
    const r = recorder({ inputs: [WEBCAM_INPUT] })
    await new WebcamController({ client: r.client, platform: 'linux', sleep }).apply(cfg())
    expect(r.calls.some((c) => c.req === 'SetSceneItemIndex')).toBe(true)
  })

  it('applies the computed transform', async () => {
    const r = recorder({ inputs: [WEBCAM_INPUT] })
    await new WebcamController({ client: r.client, platform: 'linux', sleep }).apply(cfg({ corner: 'tl', sizePct: 0.25 }))
    const t = r.calls.find((c) => c.req === 'SetSceneItemTransform')
    expect(t?.data.sceneItemTransform).toMatchObject({ positionX: 38.4, positionY: 38.4 })
  })

  it('sets all three mode properties together when a mode is chosen', async () => {
    const r = recorder({ inputs: [WEBCAM_INPUT] })
    await new WebcamController({ client: r.client, platform: 'linux', sleep })
      .apply(cfg({ mode: { pixelformat: '1196444237', resolution: '5', framerate: '3' } }))
    const set = r.calls.find((c) => c.req === 'SetInputSettings')
    expect(set?.data.inputSettings).toMatchObject({
      res_type: 1, pixelformat: '1196444237', resolution: '5', framerate: '3',
    })
  })

  it('removes the input entirely when disabled, holding no device handle', async () => {
    const r = recorder({ inputs: [WEBCAM_INPUT] })
    await new WebcamController({ client: r.client, platform: 'linux', sleep }).apply(cfg({ enabled: false }))
    expect(r.calls.some((c) => c.req === 'RemoveInput' && c.data.inputName === WEBCAM_INPUT)).toBe(true)
    expect(r.calls.some((c) => c.req === 'SetInputSettings')).toBe(false)
  })

  it('removes the input when enabled with no device selected', async () => {
    const r = recorder({ inputs: [WEBCAM_INPUT] })
    await new WebcamController({ client: r.client, platform: 'linux', sleep }).apply(cfg({ deviceId: null }))
    expect(r.calls.some((c) => c.req === 'RemoveInput')).toBe(true)
  })

  it('reports unavailable and refuses to set a device that is gone', async () => {
    const r = recorder({ inputs: [WEBCAM_INPUT], devices: [{ itemName: 'Other', itemValue: '/dev/video9' }] })
    const res = await new WebcamController({ client: r.client, platform: 'linux', sleep }).apply(cfg())
    expect(res.available).toBe(false)
    const set = r.calls.find((c) => c.req === 'SetInputSettings')
    expect(set?.data?.inputSettings?.device_id).toBeUndefined()
  })

  it('retries the transform once when the camera has not yet produced a frame', async () => {
    // 0x0 on the first read, real dimensions on the second.
    const r = recorder({ inputs: [WEBCAM_INPUT], sourceDims: [{ w: 0, h: 0 }, { w: 1280, h: 720 }] })
    const slept = vi.fn(async () => {})
    await new WebcamController({ client: r.client, platform: 'linux', sleep: slept }).apply(cfg({ corner: 'tl' }))
    expect(slept).toHaveBeenCalled()
    expect(r.calls.some((c) => c.req === 'SetSceneItemTransform')).toBe(true)
  })

  it('never throws when OBS is unreachable', async () => {
    const client = () => ({ call: vi.fn(async () => { throw new Error('not connected') }) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(new WebcamController({ client, platform: 'linux', sleep }).apply(cfg())).resolves.toEqual({ available: true })
    warn.mockRestore()
  })
})
