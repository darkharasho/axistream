import { MAX_MASKS, type MaskRect } from '../shared/state.js'

export { MAX_MASKS, type MaskRect }

export const MASK_PREFIX = 'AxiStream Mask '
export const MASK_COLOR = 0xff15110f // OBS ABGR: opaque #0f1115
export const BLUR_PREFIX = 'AxiStream Blur '
const SCENE = 'Main'
const CAPTURE = 'AxiStream Capture'
const BLUR_KIND = 'obs_composite_blur'

export interface MaskDeps {
  client(): { call(req: string, data?: unknown): Promise<any> }
}

function blurSettingsFor(m: MaskRect) {
  // CompositeBlur's rectangle effect-mask takes PERCENTAGES of the source.
  return {
    blur_algorithm: 1, blur_type: 1, radius: 30, effect_mask: 2,
    effect_mask_rect_center_x: (m.x + m.w / 2) * 100,
    effect_mask_rect_center_y: (m.y + m.h / 2) * 100,
    effect_mask_rect_width: m.w * 100,
    effect_mask_rect_height: m.h * 100,
  }
}

// Reconciles OBS scene 'Main' so its overlays exactly match `masks`.
// Idempotent; called on boot, after any capture rebuild, and on every edit.
// Best-effort throughout — masks must never block go-live.
export class MaskController {
  constructor(private readonly d: MaskDeps) {}

  async applyMasks(masks: MaskRect[], style: 'box' | 'blur'): Promise<void> {
    try {
      const c = this.d.client()
      const capped = masks.slice(0, MAX_MASKS)
      if (style === 'blur') {
        await this.removeAllMaskInputs(c)
        await this.reconcileBlurFilters(c, capped)
      } else {
        await this.removeAllBlurFilters(c)
        await this.reconcileBoxInputs(c, capped)
      }
    } catch (e) { console.warn('[masks] applyMasks failed', e) }
  }

  private async reconcileBoxInputs(c: { call(req: string, data?: unknown): Promise<any> }, masks: MaskRect[]): Promise<void> {
    const v = await c.call('GetVideoSettings') as { baseWidth?: number; baseHeight?: number }
    const baseW = Number(v?.baseWidth), baseH = Number(v?.baseHeight)
    if (!(baseW > 0) || !(baseH > 0)) return

    const wanted = new Map(masks.map((m) => [MASK_PREFIX + m.id, m]))
    const { inputs } = await c.call('GetInputList') as { inputs?: { inputName: string }[] }
    const existing = new Set((inputs ?? []).map((i) => i.inputName).filter((n) => n.startsWith(MASK_PREFIX)))

    for (const name of existing) {
      if (!wanted.has(name)) await c.call('RemoveInput', { inputName: name }).catch(() => {})
    }
    for (const [name, m] of wanted) {
      const inputSettings = { color: MASK_COLOR, width: Math.round(m.w * baseW), height: Math.round(m.h * baseH) }
      if (existing.has(name)) {
        await c.call('SetInputSettings', { inputName: name, inputSettings, overlay: true })
      } else {
        await c.call('CreateInput', { sceneName: SCENE, inputName: name, inputKind: 'color_source_v3', inputSettings })
      }
      let sceneItemId: number
      try {
        ({ sceneItemId } = await c.call('GetSceneItemId', { sceneName: SCENE, sourceName: name }) as { sceneItemId: number })
      } catch {
        // Input survived a scene rebuild but its item didn't — re-add it.
        ({ sceneItemId } = await c.call('CreateSceneItem', { sceneName: SCENE, sourceName: name }) as { sceneItemId: number })
      }
      await c.call('SetSceneItemTransform', {
        sceneName: SCENE, sceneItemId,
        sceneItemTransform: { positionX: m.x * baseW, positionY: m.y * baseH },
      })
    }
  }

  private async removeAllMaskInputs(c: { call(req: string, data?: unknown): Promise<any> }): Promise<void> {
    const { inputs } = await c.call('GetInputList') as { inputs?: { inputName: string }[] }
    for (const { inputName } of (inputs ?? [])) {
      if (inputName.startsWith(MASK_PREFIX)) {
        await c.call('RemoveInput', { inputName }).catch(() => {})
      }
    }
  }

  private async reconcileBlurFilters(c: { call(req: string, data?: unknown): Promise<any> }, masks: MaskRect[]): Promise<void> {
    const { filters } = await c.call('GetSourceFilterList', { sourceName: CAPTURE }) as { filters?: { filterName: string }[] }
    const existing = new Set((filters ?? []).map((f) => f.filterName).filter((n) => n.startsWith(BLUR_PREFIX)))
    const wanted = new Map(masks.map((m) => [BLUR_PREFIX + m.id, m]))

    for (const filterName of existing) {
      if (!wanted.has(filterName)) {
        await c.call('RemoveSourceFilter', { sourceName: CAPTURE, filterName }).catch(() => {})
      }
    }
    for (const [filterName, m] of wanted) {
      const filterSettings = blurSettingsFor(m)
      if (existing.has(filterName)) {
        await c.call('SetSourceFilterSettings', { sourceName: CAPTURE, filterName, filterSettings, overlay: true })
      } else {
        await c.call('CreateSourceFilter', { sourceName: CAPTURE, filterName, filterKind: BLUR_KIND, filterSettings })
      }
    }
  }

  private async removeAllBlurFilters(c: { call(req: string, data?: unknown): Promise<any> }): Promise<void> {
    const { filters } = await c.call('GetSourceFilterList', { sourceName: CAPTURE }) as { filters?: { filterName: string }[] }
    for (const { filterName } of (filters ?? [])) {
      if (filterName.startsWith(BLUR_PREFIX)) {
        await c.call('RemoveSourceFilter', { sourceName: CAPTURE, filterName }).catch(() => {})
      }
    }
  }
}
