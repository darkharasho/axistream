// Temporary home; Task 3 moves this to shared/state.ts and this file re-imports it.
export interface MaskRect { id: string; x: number; y: number; w: number; h: number }

export const MASK_PREFIX = 'AxiStream Mask '
export const MASK_COLOR = 0xff15110f // OBS ABGR: opaque #0f1115
export const MAX_MASKS = 8
const SCENE = 'Main'

export interface MaskDeps {
  client(): { call(req: string, data?: unknown): Promise<any> }
}

// Reconciles OBS scene 'Main' so its color-source overlays exactly match
// `masks`. Idempotent; called on boot, after any capture rebuild, and on
// every edit. Best-effort throughout — masks must never block go-live.
export class MaskController {
  constructor(private readonly d: MaskDeps) {}

  async applyMasks(masks: MaskRect[]): Promise<void> {
    try {
      const c = this.d.client()
      const v = await c.call('GetVideoSettings') as { baseWidth?: number; baseHeight?: number }
      const baseW = Number(v?.baseWidth), baseH = Number(v?.baseHeight)
      if (!(baseW > 0) || !(baseH > 0)) return

      const wanted = new Map(masks.slice(0, MAX_MASKS).map((m) => [MASK_PREFIX + m.id, m]))
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
    } catch (e) { console.warn('[masks] applyMasks failed', e) }
  }
}
