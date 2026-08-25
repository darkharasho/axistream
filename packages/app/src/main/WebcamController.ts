import { placeWebcam } from './webcam-layout.js'
import type { AudioDevice, WebcamConfig, WebcamOption, WebcamProps } from '../shared/state.js'

const SCENE = 'Main'
export const WEBCAM_INPUT = 'AxiStream Webcam'

// OBS camera input kinds differ per OS backend, mirroring audio-inputs.ts.
// The win32 branch is untested — there is no Windows camera in CI.
export const kindsFor = (platform: NodeJS.Platform) => platform === 'win32'
  ? { kind: 'dshow_input', deviceProp: 'video_device_id' }
  : { kind: 'v4l2_input', deviceProp: 'device_id' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { call(req: string, data?: unknown): Promise<any> }

export interface WebcamDeps {
  client(): Client
  platform?: NodeJS.Platform
  sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Reconciles OBS scene 'Main' so the webcam item matches `cfg`.
// Idempotent; called on boot, after any capture rebuild, and on every edit.
// Best-effort throughout — a camera must never block go-live.
export class WebcamController {
  constructor(private readonly d: WebcamDeps) {}

  async apply(cfg: WebcamConfig): Promise<{ available: boolean }> {
    const c = this.d.client()
    const { kind, deviceProp } = kindsFor(this.d.platform ?? process.platform)
    try {
      if (!cfg.enabled || !cfg.deviceId) {
        await this.removeInput(c)
        return { available: true }
      }

      // The device list can only be read from an input that already exists —
      // GetInputPropertiesListPropertyItems needs an inputName. Create first.
      await this.ensureInput(c, kind)

      // null means the enumeration itself failed (a dead websocket proves
      // nothing about the hardware); [] means OBS really sees no cameras.
      const devices = await this.listDevices(c, deviceProp)
      const available = devices === null || devices.some((d) => d.id === cfg.deviceId)
      if (!available) return { available: false }

      await c.call('SetInputSettings', {
        inputName: WEBCAM_INPUT,
        inputSettings: { [deviceProp]: cfg.deviceId, ...modeSettings(cfg) },
        overlay: true,
      })

      // No explicit z-order call. The webcam's item is created after the game
      // capture, so OBS draws it above the capture — the same
      // create-last-is-top rule MaskController relies on. An explicit
      // SetSceneItemIndex could only move it off that spot, and index
      // orientation is not something we can verify from here.
      //
      // The webcam is NOT unconditionally topmost: setMasks/setMasksVisible/
      // setMaskStyle re-run MaskController without re-running this, so a box
      // mask added while the camera is up gets its item created last and lands
      // above the camera until the next rebuild. Cosmetic only — a mask over a
      // camera leaks nothing — and re-applying the webcam on every mask drag
      // would cost an OBS round trip plus up to a second of transform retry.
      const sceneItemId = await this.sceneItemId(c)
      await this.transform(c, sceneItemId, cfg)
      return { available: true }
    } catch (e) {
      // A dead websocket proves nothing about the hardware, so availability
      // is left alone rather than blamed on the camera.
      console.warn('[webcam] apply failed', e)
      return { available: true }
    }
  }

  // Returns null when OBS could not be asked, [] when it answered with none.
  async listDevices(c: Client, deviceProp: string): Promise<{ id: string; name: string }[] | null> {
    try {
      const r = await c.call('GetInputPropertiesListPropertyItems', {
        inputName: WEBCAM_INPUT, propertyName: deviceProp,
      })
      return (r.propertyItems ?? [])
        .filter((it: { itemValue: string }) => it.itemValue)
        .map((it: { itemName: string; itemValue: string }) => ({ id: it.itemValue, name: it.itemName }))
    } catch (e) { console.warn('[webcam] listDevices failed', e); return null }
  }

  // The device list lives on the input, so the input must exist first.
  async devices(): Promise<AudioDevice[]> {
    const c = this.d.client()
    const { kind, deviceProp } = kindsFor(this.d.platform ?? process.platform)
    try {
      await this.ensureInput(c, kind)
      return (await this.listDevices(c, deviceProp)) ?? []
    } catch (e) { console.warn('[webcam] devices failed', e); return [] }
  }

  // The three lists are dependent: OBS recomputes framerates from the current
  // resolution. Each is reported as it stands right now, which is why the UI
  // re-fetches after every change instead of caching a combination list.
  async props(): Promise<WebcamProps> {
    const empty: WebcamProps = { pixelformats: [], resolutions: [], framerates: [] }
    const c = this.d.client()
    try {
      const { inputs } = await c.call('GetInputList') as { inputs?: { inputName: string }[] }
      if (!(inputs ?? []).some((i) => i.inputName === WEBCAM_INPUT)) return empty
      const [pixelformats, resolutions, framerates] = await Promise.all([
        this.options(c, 'pixelformat'),
        this.options(c, 'resolution'),
        this.options(c, 'framerate'),
      ])
      return { pixelformats, resolutions, framerates }
    } catch (e) { console.warn('[webcam] props failed', e); return empty }
  }

  private async options(c: Client, propertyName: string): Promise<WebcamOption[]> {
    try {
      const r = await c.call('GetInputPropertiesListPropertyItems', { inputName: WEBCAM_INPUT, propertyName })
      return (r.propertyItems ?? [])
        .filter((it: { itemValue: unknown }) => it.itemValue !== undefined && it.itemValue !== null && it.itemValue !== '')
        .map((it: { itemName: string; itemValue: unknown }) => ({ value: String(it.itemValue), label: it.itemName }))
    } catch { return [] }
  }

  private async ensureInput(c: Client, kind: string): Promise<void> {
    const { inputs } = await c.call('GetInputList') as { inputs?: { inputName: string }[] }
    const exists = (inputs ?? []).some((i) => i.inputName === WEBCAM_INPUT)
    if (!exists) {
      await c.call('CreateInput', { sceneName: SCENE, inputName: WEBCAM_INPUT, inputKind: kind, inputSettings: {} })
    }
  }

  private async sceneItemId(c: Client): Promise<number> {
    try {
      const { sceneItemId } = await c.call('GetSceneItemId', { sceneName: SCENE, sourceName: WEBCAM_INPUT }) as { sceneItemId: number }
      return sceneItemId
    } catch {
      // Input survived a scene rebuild but its item didn't — re-add it.
      const { sceneItemId } = await c.call('CreateSceneItem', { sceneName: SCENE, sourceName: WEBCAM_INPUT }) as { sceneItemId: number }
      return sceneItemId
    }
  }

  private async transform(c: Client, sceneItemId: number, cfg: WebcamConfig): Promise<void> {
    const sleep = this.d.sleep ?? realSleep
    for (let attempt = 0; attempt < 2; attempt++) {
      const v = await c.call('GetVideoSettings') as { baseWidth?: number; baseHeight?: number }
      const t = await c.call('GetSceneItemTransform', { sceneName: SCENE, sceneItemId }) as
        { sceneItemTransform?: { sourceWidth?: number; sourceHeight?: number } }
      const p = placeWebcam({
        corner: cfg.corner, sizePct: cfg.sizePct, mirrored: cfg.mirrored,
        baseW: Number(v?.baseWidth), baseH: Number(v?.baseHeight),
        srcW: Number(t?.sceneItemTransform?.sourceWidth), srcH: Number(t?.sceneItemTransform?.sourceHeight),
      })
      if (p) {
        await c.call('SetSceneItemTransform', { sceneName: SCENE, sceneItemId, sceneItemTransform: p })
        return
      }
      // A camera reports 0x0 until its first frame arrives. Give it one beat.
      if (attempt === 0) await sleep(1000)
    }
    console.warn('[webcam] source dimensions never arrived; left at OBS defaults')
  }

  private async removeInput(c: Client): Promise<void> {
    const { inputs } = await c.call('GetInputList').catch(() => ({ inputs: [] })) as { inputs?: { inputName: string }[] }
    if ((inputs ?? []).some((i) => i.inputName === WEBCAM_INPUT)) {
      await c.call('RemoveInput', { inputName: WEBCAM_INPUT }).catch(() => {})
    }
  }
}

function modeSettings(cfg: WebcamConfig): Record<string, unknown> {
  if (!cfg.mode) return { res_type: 0 }
  return {
    res_type: 1,
    pixelformat: cfg.mode.pixelformat,
    resolution: cfg.mode.resolution,
    framerate: cfg.mode.framerate,
  }
}
