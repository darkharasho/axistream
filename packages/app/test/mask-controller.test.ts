import { describe, it, expect, vi } from 'vitest'
import { MaskController, MASK_PREFIX, MASK_COLOR, BLUR_PREFIX, type MaskRect } from '../src/main/MaskController.js'

const CANVAS = { baseWidth: 2000, baseHeight: 1000 }

function recorder(opts: { inputs?: string[]; filters?: string[]; canvas?: object | null; failGetItemFor?: string[] } = {}) {
  const calls: { req: string; data: any }[] = []
  let itemId = 100
  const client = () => ({
    call: vi.fn(async (req: string, data?: any) => {
      calls.push({ req, data })
      if (req === 'GetVideoSettings') {
        if (opts.canvas === null) throw new Error('no video')
        return opts.canvas ?? CANVAS
      }
      if (req === 'GetInputList') return { inputs: (opts.inputs ?? []).map((inputName) => ({ inputName })) }
      if (req === 'GetSourceFilterList') return { filters: (opts.filters ?? []).map((filterName) => ({ filterName })) }
      if (req === 'GetSceneItemId') {
        if (opts.failGetItemFor?.includes(data?.sourceName)) throw new Error('not in scene')
        return { sceneItemId: ++itemId }
      }
      if (req === 'CreateSceneItem') return { sceneItemId: ++itemId }
      return {}
    }),
  })
  return { calls, client }
}

const mask = (id: string, x = 0.25, y = 0.5, w = 0.1, h = 0.2): MaskRect => ({ id, x, y, w, h })

describe('MaskController.applyMasks', () => {
  it('creates a color source per mask with pixel size and positions it', async () => {
    const r = recorder()
    await new MaskController({ client: r.client }).applyMasks([mask('a')], 'box')
    const create = r.calls.find((c) => c.req === 'CreateInput')
    expect(create?.data).toEqual({
      sceneName: 'Main', inputName: `${MASK_PREFIX}a`, inputKind: 'color_source_v3',
      inputSettings: { color: MASK_COLOR, width: 200, height: 200 },
    })
    const xform = r.calls.find((c) => c.req === 'SetSceneItemTransform')
    expect(xform?.data.sceneItemTransform).toEqual({ positionX: 500, positionY: 500 })
  })

  it('updates an existing mask input instead of recreating it', async () => {
    const r = recorder({ inputs: [`${MASK_PREFIX}a`] })
    await new MaskController({ client: r.client }).applyMasks([mask('a', 0, 0, 0.5, 0.5)], 'box')
    expect(r.calls.some((c) => c.req === 'CreateInput')).toBe(false)
    const set = r.calls.find((c) => c.req === 'SetInputSettings')
    expect(set?.data).toEqual({ inputName: `${MASK_PREFIX}a`, inputSettings: { color: MASK_COLOR, width: 1000, height: 500 }, overlay: true })
  })

  it('removes stale mask inputs but leaves other inputs alone', async () => {
    const r = recorder({ inputs: [`${MASK_PREFIX}old`, 'AxiStream Capture', 'AxiStream Mic'] })
    await new MaskController({ client: r.client }).applyMasks([], 'box')
    const removed = r.calls.filter((c) => c.req === 'RemoveInput').map((c) => c.data.inputName)
    expect(removed).toEqual([`${MASK_PREFIX}old`])
  })

  it('re-adds the scene item when the input survives a scene rebuild', async () => {
    const r = recorder({ inputs: [`${MASK_PREFIX}a`], failGetItemFor: [`${MASK_PREFIX}a`] })
    await new MaskController({ client: r.client }).applyMasks([mask('a')], 'box')
    const createItem = r.calls.find((c) => c.req === 'CreateSceneItem')
    expect(createItem?.data).toEqual({ sceneName: 'Main', sourceName: `${MASK_PREFIX}a` })
    expect(r.calls.some((c) => c.req === 'SetSceneItemTransform')).toBe(true)
  })

  it('skips silently when the canvas is unreadable', async () => {
    const r = recorder({ canvas: null })
    await expect(new MaskController({ client: r.client }).applyMasks([mask('a')], 'box')).resolves.toBeUndefined()
    // box mode sweeps blur filters first (GetSourceFilterList), then bails at GetVideoSettings
    const meaningful = r.calls.filter((c) => c.req !== 'GetVideoSettings' && c.req !== 'GetSourceFilterList')
    expect(meaningful).toEqual([])
  })

  it('swallows client errors entirely', async () => {
    const client = () => ({ call: vi.fn(async () => { throw new Error('boom') }) })
    await expect(new MaskController({ client }).applyMasks([mask('a')], 'box')).resolves.toBeUndefined()
  })
})

describe('MaskController cap', () => {
  it('creates at most MAX_MASKS inputs when given more', async () => {
    const r = recorder()
    const many = Array.from({ length: 10 }, (_, i) => mask(`m${i}`))
    await new MaskController({ client: r.client }).applyMasks(many, 'box')
    expect(r.calls.filter((c) => c.req === 'CreateInput')).toHaveLength(8)
  })
})

describe('MaskController blur style', () => {
  const m = (id: string, x = 0.25, y = 0.5, w = 0.1, h = 0.2): MaskRect => ({ id, x, y, w, h })
  const BLUR_SETTINGS = {
    blur_algorithm: 1, blur_type: 1, radius: 30, effect_mask: 2,
    effect_mask_rect_center_x: 30, effect_mask_rect_center_y: 60,
    effect_mask_rect_width: 10, effect_mask_rect_height: 20,
  }

  it('creates a composite-blur filter per mask with exact percent settings', async () => {
    const r = recorder()
    await new MaskController({ client: r.client }).applyMasks([m('a')], 'blur')
    const create = r.calls.find((c) => c.req === 'CreateSourceFilter')
    expect(create?.data).toEqual({
      sourceName: 'AxiStream Capture', filterName: `${BLUR_PREFIX}a`,
      filterKind: 'obs_composite_blur', filterSettings: BLUR_SETTINGS,
    })
  })

  it('updates an existing blur filter instead of recreating', async () => {
    const r = recorder({ filters: [`${BLUR_PREFIX}a`] })
    await new MaskController({ client: r.client }).applyMasks([m('a')], 'blur')
    expect(r.calls.some((c) => c.req === 'CreateSourceFilter')).toBe(false)
    expect(r.calls.find((c) => c.req === 'SetSourceFilterSettings')?.data).toEqual({
      sourceName: 'AxiStream Capture', filterName: `${BLUR_PREFIX}a`, filterSettings: BLUR_SETTINGS, overlay: true,
    })
  })

  it('removes stale blur filters, leaves non-AxiStream filters alone', async () => {
    const r = recorder({ filters: [`${BLUR_PREFIX}old`, 'User Sharpen'] })
    await new MaskController({ client: r.client }).applyMasks([], 'blur')
    const removed = r.calls.filter((c) => c.req === 'RemoveSourceFilter').map((c) => c.data.filterName)
    expect(removed).toEqual([`${BLUR_PREFIX}old`])
  })

  it('blur style sweeps mask color inputs (style switch box→blur)', async () => {
    const r = recorder({ inputs: [`${MASK_PREFIX}a`] })
    await new MaskController({ client: r.client }).applyMasks([m('a')], 'blur')
    expect(r.calls.find((c) => c.req === 'RemoveInput')?.data).toEqual({ inputName: `${MASK_PREFIX}a` })
    expect(r.calls.some((c) => c.req === 'CreateSourceFilter')).toBe(true)
  })

  it('box style sweeps blur filters (style switch blur→box)', async () => {
    const r = recorder({ filters: [`${BLUR_PREFIX}a`] })
    await new MaskController({ client: r.client }).applyMasks([m('a')], 'box')
    expect(r.calls.filter((c) => c.req === 'RemoveSourceFilter').map((c) => c.data.filterName)).toEqual([`${BLUR_PREFIX}a`])
    expect(r.calls.some((c) => c.req === 'CreateInput')).toBe(true)
  })

  it('throwing client swallowed in blur mode', async () => {
    const client = () => ({ call: vi.fn(async () => { throw new Error('boom') }) })
    await expect(new MaskController({ client }).applyMasks([m('a')], 'blur')).resolves.toBeUndefined()
  })
})
