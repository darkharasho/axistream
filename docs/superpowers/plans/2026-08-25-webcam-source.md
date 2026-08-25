# Webcam Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Composite a camera into the stream as an OBS scene item — pick a device, put it in a corner, size it, optionally mirror it — without ever blocking boot or go-live.

**Architecture:** A `WebcamController` modeled on the existing `MaskController`: one idempotent, best-effort `apply(cfg)` that reconciles a single OBS input named `AxiStream Webcam` to match config, re-invoked from the three sites that already re-apply masks after a capture rebuild. Placement is a pure function in a separate module so it tests as arithmetic with no OBS and no DOM.

**Tech Stack:** Electron 31, React 18, TypeScript (ESM/NodeNext), obs-websocket via the app's existing client, Vitest 2 + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-25-webcam-source-design.md`

## Global Constraints

- Code style: 2-space indent, **no semicolons**, single quotes, named exports, `.js` extensions on relative imports. No linter is configured — match surrounding code exactly.
- **OBS calls are best-effort.** Every OBS interaction is wrapped so it `console.warn`s and returns; nothing may throw out of the main process. The camera must never block boot, go-live, or quit.
- **The scene-rebuild landmine:** a rebuild (`RemoveScene` + `CreateScene`) destroys scene *items* while inputs survive. An input with no scene item is inactive. Every scene-item source must re-add itself via `try { GetSceneItemId } catch { CreateSceneItem }`. This silenced mic and desktop audio before `cf03496`.
- **Conditions live in `AppState`; the toast channel carries only discrete events.** `available` is a condition (a chip); only the *transition* into unavailable fires a toast.
- Tests: `npm -w @axistream/app run test`. Vitest fork pool is capped at `maxForks: 2` in config — do not raise it.
- Typecheck gate: `cd packages/app && npx tsc --noEmit -p tsconfig.json`.
- Do not refactor the three rebuild call sites in `main/index.ts`. They are known debt, recorded in the spec, and out of scope here.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/app/src/shared/state.ts` (modify) | `WebcamCorner`, `WebcamMode`, `WebcamOption`, `WebcamProps`, `WebcamConfig`, `WebcamView`; `AppState.webcam`; three new `CH` channels; three new `AxiApi` methods |
| `packages/app/src/main/webcam-layout.ts` (create) | Pure placement arithmetic. No OBS, no DOM. |
| `packages/app/src/main/WebcamController.ts` (create) | OBS reconcile: input lifecycle, scene-item re-add, z-order pin, transform, device/props enumeration, availability |
| `packages/app/src/main/StreamSettings.ts` (modify) | `webcam` field, `DEFAULT_SETTINGS` entry, `sanitizeWebcam` |
| `packages/app/src/main/ipc.ts` (modify) | Three handler signatures + registrations |
| `packages/app/src/preload/index.ts` (modify) | Three `AxiApi` bridges |
| `packages/app/src/main/index.ts` (modify) | Construct controller, boot apply, three rebuild hooks, three IPC handlers, unavailable-transition toast |
| `packages/app/src/renderer/components/WebcamSettings.tsx` (create) | Settings section UI |
| `packages/app/src/renderer/components/SettingsScreen.tsx` (modify) | Mount `WebcamSettings` between Audio and Quality |
| `packages/app/src/renderer/components/StreamScreen.tsx` (modify) | Quick on/off toggle |

---

## Task 1: Shared types and settings persistence

**Files:**
- Modify: `packages/app/src/shared/state.ts`
- Modify: `packages/app/src/main/StreamSettings.ts`
- Test: `packages/app/test/stream-settings.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `WebcamCorner`, `WebcamMode`, `WebcamOption`, `WebcamProps`, `WebcamConfig`, `WebcamView`, `DEFAULT_WEBCAM`, `sanitizeWebcam(raw: unknown): WebcamConfig`, `AppState.webcam: WebcamView`, and `StreamSettingsData.webcam: WebcamConfig`.

- [ ] **Step 1: Add the types to `packages/app/src/shared/state.ts`**

Insert after the `MaskRect`/`MAX_MASKS` declarations (near line 10):

```ts
export type WebcamCorner = 'tl' | 'tr' | 'bl' | 'br'
export const WEBCAM_MIN_SIZE_PCT = 0.15
export const WEBCAM_MAX_SIZE_PCT = 0.35

// All three OBS v4l2 properties, set together. Picking a resolution without
// its pixel format is what produces the 5fps YUYV case this override escapes.
export interface WebcamMode { pixelformat: string; resolution: string; framerate: string }
export interface WebcamOption { value: string; label: string }
export interface WebcamProps {
  pixelformats: WebcamOption[]
  resolutions: WebcamOption[]
  framerates: WebcamOption[]
}

export interface WebcamConfig {
  enabled: boolean
  deviceId: string | null
  deviceLabel: string | null
  corner: WebcamCorner
  sizePct: number
  mirrored: boolean
  mode: WebcamMode | null
}

export interface WebcamView extends WebcamConfig {
  /** Condition, not an event: drives a chip. Never persisted. */
  available: boolean
}

export const DEFAULT_WEBCAM: WebcamConfig = {
  enabled: false,
  deviceId: null,
  deviceLabel: null,
  corner: 'br',
  sizePct: 0.22,
  mirrored: false,
  mode: null,
}
```

- [ ] **Step 2: Add `webcam` to `AppState` and `INITIAL_STATE`**

In the `AppState` interface, after `watchUrl: string | null`, add:

```ts
  webcam: WebcamView
```

In `INITIAL_STATE`, after `watchUrl: null,`, add:

```ts
  webcam: { ...DEFAULT_WEBCAM, available: true },
```

`available` starts `true` because "unavailable" is a claim we have not yet earned — the camera has not been checked, and a chip on a fresh install with no camera configured would be a lie.

- [ ] **Step 3: Write the failing persistence tests**

Append to `packages/app/test/stream-settings.test.ts`:

```ts
describe('webcam settings', () => {
  it('defaults to a disabled bottom-right webcam', () => {
    const s = new StreamSettings(tmpFile())
    expect(s.load().webcam).toEqual({
      enabled: false, deviceId: null, deviceLabel: null,
      corner: 'br', sizePct: 0.22, mirrored: false, mode: null,
    })
  })

  it('round-trips a configured webcam', () => {
    const s = new StreamSettings(tmpFile())
    s.patch({ webcam: { enabled: true, deviceId: '/dev/video0', deviceLabel: 'C920', corner: 'tl', sizePct: 0.3, mirrored: true, mode: null } })
    expect(s.load().webcam.deviceId).toBe('/dev/video0')
    expect(s.load().webcam.corner).toBe('tl')
    expect(s.load().webcam.mirrored).toBe(true)
  })

  it('clamps an out-of-range sizePct and rejects a bogus corner', () => {
    expect(sanitizeWebcam({ sizePct: 0.9, corner: 'middle' })).toMatchObject({ sizePct: 0.35, corner: 'br' })
    expect(sanitizeWebcam({ sizePct: 0.01 })).toMatchObject({ sizePct: 0.15 })
  })

  it('drops a partial mode rather than half-applying it', () => {
    expect(sanitizeWebcam({ mode: { resolution: '1920x1080' } }).mode).toBeNull()
    expect(sanitizeWebcam({ mode: { pixelformat: '1196444237', resolution: '5', framerate: '3' } }).mode)
      .toEqual({ pixelformat: '1196444237', resolution: '5', framerate: '3' })
  })

  it('falls back to defaults for a non-object webcam value', () => {
    expect(sanitizeWebcam(null)).toEqual(DEFAULT_WEBCAM)
    expect(sanitizeWebcam('nope')).toEqual(DEFAULT_WEBCAM)
  })
})
```

Add `sanitizeWebcam` to the existing `StreamSettings` import in that file, and `DEFAULT_WEBCAM` from `../src/shared/state.js`. If the file has no `tmpFile()` helper, reuse whatever temp-path helper the existing tests in that file already use.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm -w @axistream/app run test -- stream-settings`
Expected: FAIL — `sanitizeWebcam` is not exported.

- [ ] **Step 5: Implement `sanitizeWebcam` in `StreamSettings.ts`**

Add the import of the new types to the existing `../shared/state.js` import line, then add beside `sanitizeGameAudioApps`:

```ts
const CORNERS: WebcamCorner[] = ['tl', 'tr', 'bl', 'br']

export function sanitizeWebcam(raw: unknown): WebcamConfig {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_WEBCAM }
  const r = raw as Record<string, unknown>
  // A mode is all three properties or none — a resolution without its pixel
  // format is exactly the broken combination the override exists to avoid.
  let mode: WebcamMode | null = null
  const m = r.mode
  if (typeof m === 'object' && m !== null) {
    const { pixelformat, resolution, framerate } = m as Record<string, unknown>
    if (typeof pixelformat === 'string' && pixelformat && typeof resolution === 'string' && resolution && typeof framerate === 'string' && framerate) {
      mode = { pixelformat, resolution, framerate }
    }
  }
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_WEBCAM.enabled,
    deviceId: typeof r.deviceId === 'string' && r.deviceId ? r.deviceId : null,
    deviceLabel: typeof r.deviceLabel === 'string' && r.deviceLabel ? r.deviceLabel : null,
    corner: CORNERS.includes(r.corner as WebcamCorner) ? (r.corner as WebcamCorner) : DEFAULT_WEBCAM.corner,
    sizePct: typeof r.sizePct === 'number' && Number.isFinite(r.sizePct)
      ? clamp(r.sizePct, WEBCAM_MIN_SIZE_PCT, WEBCAM_MAX_SIZE_PCT)
      : DEFAULT_WEBCAM.sizePct,
    mirrored: typeof r.mirrored === 'boolean' ? r.mirrored : DEFAULT_WEBCAM.mirrored,
    mode,
  }
}
```

Add `webcam: WebcamConfig` to `StreamSettingsData`, `webcam: { ...DEFAULT_WEBCAM }` to `DEFAULT_SETTINGS`, and `webcam: sanitizeWebcam(raw.webcam),` to the object returned by `load()`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm -w @axistream/app run test -- stream-settings`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..
git add packages/app/src/shared/state.ts packages/app/src/main/StreamSettings.ts packages/app/test/stream-settings.test.ts
git commit -m "feat(webcam): shared types and settings persistence"
```

---

## Task 2: Placement arithmetic

**Files:**
- Create: `packages/app/src/main/webcam-layout.ts`
- Test: `packages/app/test/webcam-layout.test.ts`

**Interfaces:**
- Consumes: `WebcamCorner`, `WEBCAM_MIN_SIZE_PCT`, `WEBCAM_MAX_SIZE_PCT` from Task 1.
- Produces: `placeWebcam(i: PlaceInput): Placement | null`, `WEBCAM_MARGIN_PCT`.
  - `PlaceInput = { corner: WebcamCorner; sizePct: number; mirrored: boolean; baseW: number; baseH: number; srcW: number; srcH: number }`
  - `Placement = { positionX: number; positionY: number; scaleX: number; scaleY: number }`

- [ ] **Step 1: Write the failing tests**

Create `packages/app/test/webcam-layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { placeWebcam } from '../src/main/webcam-layout.js'

// 1920x1080 canvas, 1280x720 camera, 25% width:
//   targetW = 480, scale = 0.375, targetH = 270, margin = 38.4
const BASE = { baseW: 1920, baseH: 1080, srcW: 1280, srcH: 720, sizePct: 0.25, mirrored: false }

describe('placeWebcam', () => {
  it('scales to sizePct of canvas width and preserves aspect', () => {
    const p = placeWebcam({ ...BASE, corner: 'tl' })!
    expect(p.scaleX).toBeCloseTo(0.375)
    expect(p.scaleY).toBeCloseTo(0.375)
  })

  it('places each corner inside its margin', () => {
    expect(placeWebcam({ ...BASE, corner: 'tl' })!).toMatchObject({ positionX: 38.4, positionY: 38.4 })
    expect(placeWebcam({ ...BASE, corner: 'tr' })!.positionX).toBeCloseTo(1401.6)
    expect(placeWebcam({ ...BASE, corner: 'tr' })!.positionY).toBeCloseTo(38.4)
    expect(placeWebcam({ ...BASE, corner: 'bl' })!.positionX).toBeCloseTo(38.4)
    expect(placeWebcam({ ...BASE, corner: 'bl' })!.positionY).toBeCloseTo(771.6)
    expect(placeWebcam({ ...BASE, corner: 'br' })!.positionX).toBeCloseTo(1401.6)
    expect(placeWebcam({ ...BASE, corner: 'br' })!.positionY).toBeCloseTo(771.6)
  })

  // The single most likely defect in the feature: OBS scales a scene item
  // about its origin, so a negative scaleX draws it LEFTWARD from positionX.
  it('offsets positionX by the target width when mirrored so the image does not move', () => {
    const plain = placeWebcam({ ...BASE, corner: 'br' })!
    const mirrored = placeWebcam({ ...BASE, corner: 'br', mirrored: true })!
    expect(mirrored.scaleX).toBeCloseTo(-0.375)
    expect(mirrored.scaleY).toBeCloseTo(0.375)
    // Drawn content still spans the same horizontal band.
    expect(mirrored.positionX - 480).toBeCloseTo(plain.positionX)
    // ...and its right edge still sits one margin from the canvas edge.
    expect(mirrored.positionX).toBeCloseTo(1920 - 38.4)
  })

  it('mirrors the top-left corner without pushing it off-canvas', () => {
    const m = placeWebcam({ ...BASE, corner: 'tl', mirrored: true })!
    expect(m.positionX - 480).toBeCloseTo(38.4)
  })

  it('clamps sizePct to the 0.15-0.35 range', () => {
    expect(placeWebcam({ ...BASE, corner: 'tl', sizePct: 0.9 })!.scaleX).toBeCloseTo(0.35 * 1920 / 1280)
    expect(placeWebcam({ ...BASE, corner: 'tl', sizePct: 0.01 })!.scaleX).toBeCloseTo(0.15 * 1920 / 1280)
  })

  it('returns null when any dimension is missing', () => {
    // A camera reports 0x0 until its first frame arrives; dividing by that
    // would produce Infinity and shove the item off-canvas.
    expect(placeWebcam({ ...BASE, corner: 'tl', srcW: 0 })).toBeNull()
    expect(placeWebcam({ ...BASE, corner: 'tl', srcH: 0 })).toBeNull()
    expect(placeWebcam({ ...BASE, corner: 'tl', baseW: 0 })).toBeNull()
    expect(placeWebcam({ ...BASE, corner: 'tl', baseH: 0 })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w @axistream/app run test -- webcam-layout`
Expected: FAIL — cannot resolve `../src/main/webcam-layout.js`.

- [ ] **Step 3: Implement `webcam-layout.ts`**

```ts
import { WEBCAM_MIN_SIZE_PCT, WEBCAM_MAX_SIZE_PCT, type WebcamCorner } from '../shared/state.js'

export const WEBCAM_MARGIN_PCT = 0.02

export interface PlaceInput {
  corner: WebcamCorner
  sizePct: number
  mirrored: boolean
  baseW: number
  baseH: number
  srcW: number
  srcH: number
}

export interface Placement {
  positionX: number
  positionY: number
  scaleX: number
  scaleY: number
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// Pure: canvas + source dimensions + corner + size -> an OBS scene-item
// transform. Returns null when any dimension is unusable, which happens for
// real: a camera input reports 0x0 until its first frame arrives.
export function placeWebcam(i: PlaceInput): Placement | null {
  if (!(i.baseW > 0) || !(i.baseH > 0) || !(i.srcW > 0) || !(i.srcH > 0)) return null

  const sizePct = clamp(i.sizePct, WEBCAM_MIN_SIZE_PCT, WEBCAM_MAX_SIZE_PCT)
  const targetW = sizePct * i.baseW
  const scale = targetW / i.srcW
  const targetH = i.srcH * scale
  const margin = WEBCAM_MARGIN_PCT * i.baseW

  const x = i.corner === 'tl' || i.corner === 'bl' ? margin : i.baseW - margin - targetW
  const y = i.corner === 'tl' || i.corner === 'tr' ? margin : i.baseH - margin - targetH

  // OBS scales a scene item about its origin, so a negative scaleX draws the
  // item leftward from positionX. Shift right by one target width to keep the
  // visible image exactly where the un-mirrored image would have been.
  return {
    positionX: i.mirrored ? x + targetW : x,
    positionY: y,
    scaleX: i.mirrored ? -scale : scale,
    scaleY: scale,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w @axistream/app run test -- webcam-layout`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/webcam-layout.ts packages/app/test/webcam-layout.test.ts
git commit -m "feat(webcam): pure corner placement arithmetic"
```

---

## Task 3: WebcamController reconcile

**Files:**
- Create: `packages/app/src/main/WebcamController.ts`
- Test: `packages/app/test/webcam-controller.test.ts`

**Interfaces:**
- Consumes: `placeWebcam` (Task 2); `WebcamConfig` (Task 1).
- Produces:
  - `WEBCAM_INPUT = 'AxiStream Webcam'`
  - `kindsFor(platform: NodeJS.Platform): { kind: string; deviceProp: string }`
  - `class WebcamController` with `constructor(d: WebcamDeps)` and `apply(cfg: WebcamConfig): Promise<{ available: boolean }>`
  - `WebcamDeps = { client(): { call(req: string, data?: unknown): Promise<any> }; platform?: NodeJS.Platform; sleep?: (ms: number) => Promise<void> }`

**Ordering note the implementer must not "simplify" away:** the device list can only be read from an input that already exists, because `GetInputPropertiesListPropertyItems` needs an `inputName`. So `apply` must ensure the input exists *before* enumerating devices, and only then decide availability and set the device. Enumerating first is impossible, not merely slower.

- [ ] **Step 1: Write the failing tests**

Create `packages/app/test/webcam-controller.test.ts`:

```ts
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
```

Note the last test's expectation: when OBS is unreachable we cannot prove the camera is missing, so `available` stays `true`. Reporting "camera unavailable" because the *websocket* is down would be a false accusation against the hardware.

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w @axistream/app run test -- webcam-controller`
Expected: FAIL — cannot resolve `../src/main/WebcamController.js`.

- [ ] **Step 3: Implement `WebcamController.ts`**

```ts
import { placeWebcam } from './webcam-layout.js'
import type { WebcamConfig } from '../shared/state.js'

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

      const devices = await this.listDevices(c, deviceProp)
      const available = devices.length === 0 || devices.some((d) => d.id === cfg.deviceId)
      if (!available) return { available: false }

      await c.call('SetInputSettings', {
        inputName: WEBCAM_INPUT,
        inputSettings: { [deviceProp]: cfg.deviceId, ...modeSettings(cfg) },
        overlay: true,
      })

      const sceneItemId = await this.sceneItemId(c)
      await c.call('SetSceneItemIndex', { sceneName: SCENE, sceneItemId, sceneItemIndex: 0 }).catch(() => {})
      await this.transform(c, sceneItemId, cfg)
      return { available: true }
    } catch (e) {
      // A dead websocket proves nothing about the hardware, so availability
      // is left alone rather than blamed on the camera.
      console.warn('[webcam] apply failed', e)
      return { available: true }
    }
  }

  async listDevices(c: Client, deviceProp: string): Promise<{ id: string; name: string }[]> {
    try {
      const r = await c.call('GetInputPropertiesListPropertyItems', {
        inputName: WEBCAM_INPUT, propertyName: deviceProp,
      })
      return (r.propertyItems ?? [])
        .filter((it: { itemValue: string }) => it.itemValue)
        .map((it: { itemName: string; itemValue: string }) => ({ id: it.itemValue, name: it.itemName }))
    } catch (e) { console.warn('[webcam] listDevices failed', e); return [] }
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w @axistream/app run test -- webcam-controller`
Expected: PASS, 12 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..
git add packages/app/src/main/WebcamController.ts packages/app/test/webcam-controller.test.ts
git commit -m "feat(webcam): OBS reconcile with rebuild-safe scene item"
```

---

## Task 4: Device and property enumeration

**Files:**
- Modify: `packages/app/src/main/WebcamController.ts`
- Test: `packages/app/test/webcam-controller.test.ts`

**Interfaces:**
- Consumes: `WebcamController` (Task 3), `WebcamProps`/`WebcamOption` (Task 1).
- Produces: `WebcamController.devices(): Promise<AudioDevice[]>` and `WebcamController.props(): Promise<WebcamProps>`.

`AudioDevice` is the existing `{ id: string; name: string }` shape from `shared/state.js`; it is reused rather than duplicated.

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/test/webcam-controller.test.ts`:

```ts
describe('WebcamController.devices', () => {
  it('creates the input if needed, then lists cameras as id/name pairs', async () => {
    const r = recorder({ devices: [
      { itemName: 'C920', itemValue: '/dev/video0' },
      { itemName: 'Kiyo', itemValue: '/dev/video2' },
    ] })
    const list = await new WebcamController({ client: r.client, platform: 'linux', sleep }).devices()
    expect(list).toEqual([
      { id: '/dev/video0', name: 'C920' },
      { id: '/dev/video2', name: 'Kiyo' },
    ])
    expect(r.calls.some((c) => c.req === 'CreateInput')).toBe(true)
  })

  it('returns an empty list rather than throwing when OBS is down', async () => {
    const client = () => ({ call: vi.fn(async () => { throw new Error('down') }) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(new WebcamController({ client, platform: 'linux', sleep }).devices()).resolves.toEqual([])
    warn.mockRestore()
  })
})

describe('WebcamController.props', () => {
  it('returns the three dependent property lists', async () => {
    const byProp: Record<string, { itemName: string; itemValue: string }[]> = {
      pixelformat: [{ itemName: 'MJPEG', itemValue: '1196444237' }],
      resolution: [{ itemName: '1920x1080', itemValue: '5' }],
      framerate: [{ itemName: '60', itemValue: '3' }],
    }
    const calls: { req: string; data: any }[] = []
    const client = () => ({
      call: vi.fn(async (req: string, data?: any) => {
        calls.push({ req, data })
        if (req === 'GetInputList') return { inputs: [{ inputName: WEBCAM_INPUT }] }
        if (req === 'GetInputPropertiesListPropertyItems') {
          return { propertyItems: byProp[data.propertyName] ?? [] }
        }
        return {}
      }),
    })
    const p = await new WebcamController({ client, platform: 'linux', sleep }).props()
    expect(p.pixelformats).toEqual([{ value: '1196444237', label: 'MJPEG' }])
    expect(p.resolutions).toEqual([{ value: '5', label: '1920x1080' }])
    expect(p.framerates).toEqual([{ value: '3', label: '60' }])
  })

  it('returns empty lists when OBS is down', async () => {
    const client = () => ({ call: vi.fn(async () => { throw new Error('down') }) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(new WebcamController({ client, platform: 'linux', sleep }).props())
      .resolves.toEqual({ pixelformats: [], resolutions: [], framerates: [] })
    warn.mockRestore()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w @axistream/app run test -- webcam-controller`
Expected: FAIL — `devices is not a function`.

- [ ] **Step 3: Implement both methods**

Add the import of `AudioDevice` and `WebcamProps`/`WebcamOption` to the existing `../shared/state.js` import, then add these public methods to `WebcamController`:

```ts
  // The device list lives on the input, so the input must exist first.
  async devices(): Promise<AudioDevice[]> {
    const c = this.d.client()
    const { kind, deviceProp } = kindsFor(this.d.platform ?? process.platform)
    try {
      await this.ensureInput(c, kind)
      return await this.listDevices(c, deviceProp)
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
```

Change `private async ensureInput` and `private async listDevices` visibility only if needed — `listDevices` is already public in Task 3's implementation; leave `ensureInput` private since both new methods are inside the class.

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w @axistream/app run test -- webcam-controller`
Expected: PASS, 16 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..
git add packages/app/src/main/WebcamController.ts packages/app/test/webcam-controller.test.ts
git commit -m "feat(webcam): device and dependent property enumeration"
```

---

## Task 5: IPC channels and preload bridge

**Files:**
- Modify: `packages/app/src/shared/state.ts` (`CH`, `AxiApi`)
- Modify: `packages/app/src/main/ipc.ts`
- Modify: `packages/app/src/preload/index.ts`
- Test: `packages/app/test/ipc-contract.test.ts`

**Interfaces:**
- Consumes: `WebcamConfig`, `WebcamProps` (Task 1); `AudioDevice` (existing).
- Produces: `CH.setWebcam`, `CH.getWebcamDevices`, `CH.getWebcamProps`; `AxiApi.setWebcam(p: Partial<WebcamConfig>): Promise<void>`, `AxiApi.getWebcamDevices(): Promise<AudioDevice[]>`, `AxiApi.getWebcamProps(): Promise<WebcamProps>`.

Three channels, not one per field. The partial-update shape follows the existing `saveSettings(p: Partial<StreamSettingsView>)`; per-field channels in the `setMicDevice` style would mean six new ones for one feature.

- [ ] **Step 1: Add the channels to `CH` in `shared/state.ts`**

After `exportDiagnostics: 'axi:exportDiagnostics',` and the recording channels, add:

```ts
  setWebcam: 'axi:setWebcam',
  getWebcamDevices: 'axi:getWebcamDevices',
  getWebcamProps: 'axi:getWebcamProps',
```

- [ ] **Step 2: Add the three methods to the `AxiApi` interface**

After `exportDiagnostics(): Promise<DiagnosticsResult>`, add:

```ts
  setWebcam(p: Partial<WebcamConfig>): Promise<void>
  getWebcamDevices(): Promise<AudioDevice[]>
  getWebcamProps(): Promise<WebcamProps>
```

- [ ] **Step 3: Add the failing contract assertions**

In `packages/app/test/ipc-contract.test.ts`, in the first test's `commandChannels` array, append:

```ts
      CH.setWebcam, CH.getWebcamDevices, CH.getWebcamProps,
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm -w @axistream/app run test -- ipc-contract`
Expected: FAIL — `expect(handled.has(undefined)).toBe(true)` / channel not registered.

- [ ] **Step 5: Register the handlers in `ipc.ts`**

Add to the `IpcHandlers` interface:

```ts
  setWebcam(p: Partial<WebcamConfig>): Promise<void>
  getWebcamDevices(): Promise<AudioDevice[]>
  getWebcamProps(): Promise<WebcamProps>
```

Add `WebcamConfig` and `WebcamProps` to the existing `../shared/state.js` type import, then add to `registerIpc`, beside the recording registrations:

```ts
  ipcMain.handle(CH.setWebcam, (_e: unknown, p: Partial<WebcamConfig>) => handlers.setWebcam(p))
  ipcMain.handle(CH.getWebcamDevices, () => handlers.getWebcamDevices())
  ipcMain.handle(CH.getWebcamProps, () => handlers.getWebcamProps())
```

- [ ] **Step 6: Bridge them in `preload/index.ts`**

Add `WebcamConfig` and `WebcamProps` to the existing `../shared/state.js` type import, then add to the `api` object:

```ts
  setWebcam: (p) => ipcRenderer.invoke(CH.setWebcam, p) as Promise<void>,
  getWebcamDevices: () => ipcRenderer.invoke(CH.getWebcamDevices) as Promise<AudioDevice[]>,
  getWebcamProps: () => ipcRenderer.invoke(CH.getWebcamProps) as Promise<WebcamProps>,
```

- [ ] **Step 7: Run to verify it passes**

Run: `npm -w @axistream/app run test -- ipc-contract`
Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

```bash
cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..
git add packages/app/src/shared/state.ts packages/app/src/main/ipc.ts packages/app/src/preload/index.ts packages/app/test/ipc-contract.test.ts
git commit -m "feat(webcam): IPC channels and preload bridge"
```

---

## Task 6: Main-process wiring

**Files:**
- Modify: `packages/app/src/main/index.ts`
- Test: `packages/app/test/webcam-availability.test.ts` (create)

**Interfaces:**
- Consumes: `WebcamController` (Tasks 3-4), `sanitizeWebcam` (Task 1), the three IPC handler names (Task 5).
- Produces: `webcamToast(prev: boolean, next: boolean, enabled: boolean): 'unavailable' | null` exported from `packages/app/src/main/webcam-availability.ts`.

`main/index.ts` is the app's boot module and has no test seam, so the one piece of *decision* logic here — when the unavailable toast fires — is extracted into a pure module that does have one. Everything else in this task is wiring, verified by reading and by the manual smoke in Task 9.

- [ ] **Step 1: Write the failing test for the toast rule**

Create `packages/app/test/webcam-availability.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { webcamToast } from '../src/main/webcam-availability.js'

describe('webcamToast', () => {
  it('fires once on the transition into unavailable', () => {
    expect(webcamToast(true, false, true)).toBe('unavailable')
  })

  it('stays silent while it remains unavailable', () => {
    // The chip in AppState carries the ongoing condition; the toast channel
    // carries only discrete events. Re-toasting every reconcile would spam.
    expect(webcamToast(false, false, true)).toBeNull()
  })

  it('stays silent on recovery', () => {
    expect(webcamToast(false, true, true)).toBeNull()
  })

  it('stays silent when the webcam is disabled', () => {
    expect(webcamToast(true, false, false)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w @axistream/app run test -- webcam-availability`
Expected: FAIL — cannot resolve `../src/main/webcam-availability.js`.

- [ ] **Step 3: Implement `packages/app/src/main/webcam-availability.ts`**

```ts
// `available` is a condition and lives in AppState as a chip; the toast
// channel carries only discrete events. So a toast fires on the edge into
// unavailable and never while the condition persists.
export function webcamToast(prev: boolean, next: boolean, enabled: boolean): 'unavailable' | null {
  if (!enabled) return null
  if (prev && !next) return 'unavailable'
  return null
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w @axistream/app run test -- webcam-availability`
Expected: PASS, 4 tests.

- [ ] **Step 5: Construct the controller and apply on boot**

In `main/index.ts`, beside where `maskCtl` is constructed, add:

```ts
const webcamCtl = new WebcamController({ client: () => capture.client() })
```

Use whatever expression the neighbouring controllers (`maskCtl`, `gameAudio`) use for `client` — copy it exactly rather than inventing one.

Then add, next to `applyMasksRespectingVisibility`:

```ts
const applyWebcam = async () => {
  const cfg = settings.load().webcam
  const prev = state.webcam.available
  const { available } = await webcamCtl.apply(cfg)
  setState({ webcam: { ...cfg, available } })
  if (webcamToast(prev, available, cfg.enabled)) {
    toast({ kind: 'error', message: 'Camera unavailable', detail: cfg.deviceLabel ?? cfg.deviceId ?? undefined })
  }
}
```

Use the existing toast helper in that file under whatever name it already has — grep for how the recording code emits toasts and match it.

Seed initial state from settings wherever the other persisted fields are seeded at boot, adding `webcam: { ...settings.load().webcam, available: true }`, and call `await applyWebcam()` on the boot path beside the existing `applyMasksRespectingVisibility()` boot call.

- [ ] **Step 6: Hook the three rebuild sites**

In each of `provision`, `repairCapture`, and `switchSource`, add `await applyWebcam()` immediately after the existing `await applyMasksRespectingVisibility()` call.

**This is the scene-rebuild landmine.** A rebuild destroys scene items while inputs survive; missing one of these three sites means the camera silently vanishes from the stream after a capture repair, which is precisely how mic and desktop audio broke before `cf03496`. There are exactly three; verify with:

```bash
grep -n "applyMasksRespectingVisibility()" packages/app/src/main/index.ts
```

Every line that call appears on inside `provision`, `repairCapture`, or `switchSource` needs an `applyWebcam()` beside it. (Lines where it appears inside a mask *edit* handler do not — those did not rebuild the scene.)

- [ ] **Step 7: Add the three IPC handlers**

Beside the recording handlers in the handlers object:

```ts
    setWebcam: async (p: Partial<WebcamConfig>) => {
      const next = sanitizeWebcam({ ...settings.load().webcam, ...p })
      settings.patch({ webcam: next })
      await applyWebcam()
    },
    getWebcamDevices: () => webcamCtl.devices(),
    getWebcamProps: () => webcamCtl.props(),
```

Sanitizing the *merged* result rather than the patch is deliberate: it clamps a bad `sizePct` and rejects a partial `mode` no matter which field the renderer sent.

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm -w @axistream/app run test` then `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: all tests pass, tsc clean.

- [ ] **Step 9: Commit**

```bash
git add packages/app/src/main/index.ts packages/app/src/main/webcam-availability.ts packages/app/test/webcam-availability.test.ts
git commit -m "feat(webcam): main-process wiring and rebuild hooks"
```

---

## Task 7: Settings UI

**Files:**
- Create: `packages/app/src/renderer/components/WebcamSettings.tsx`
- Modify: `packages/app/src/renderer/components/SettingsScreen.tsx`
- Modify: `packages/app/src/renderer/styles.css`
- Test: `packages/app/test/webcam-settings.test.tsx` (create)

**Interfaces:**
- Consumes: `AppState['webcam']`, `AxiApi` (Tasks 1, 5).
- Produces: `WebcamSettings({ webcam, axi }: { webcam: WebcamView; axi: AxiApi })`.

- [ ] **Step 1: Write the failing tests**

Create `packages/app/test/webcam-settings.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WebcamSettings } from '../src/renderer/components/WebcamSettings.js'
import { DEFAULT_WEBCAM, type WebcamView } from '../src/shared/state.js'

const view = (p: Partial<WebcamView> = {}): WebcamView => ({ ...DEFAULT_WEBCAM, available: true, ...p })

const api = (over: Record<string, unknown> = {}) => ({
  setWebcam: vi.fn(async () => {}),
  getWebcamDevices: vi.fn(async () => [{ id: '/dev/video0', name: 'C920' }]),
  getWebcamProps: vi.fn(async () => ({ pixelformats: [], resolutions: [], framerates: [] })),
  ...over,
} as any)

describe('WebcamSettings', () => {
  it('lists cameras from the main process', async () => {
    render(<WebcamSettings webcam={view()} axi={api()} />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'C920' })).toBeTruthy())
  })

  it('enables the camera through setWebcam', async () => {
    const axi = api()
    render(<WebcamSettings webcam={view()} axi={axi} />)
    await userEvent.click(screen.getByLabelText(/show my camera/i))
    expect(axi.setWebcam).toHaveBeenCalledWith({ enabled: true })
  })

  it('sends the chosen corner', async () => {
    const axi = api()
    render(<WebcamSettings webcam={view({ enabled: true, deviceId: '/dev/video0' })} axi={axi} />)
    await userEvent.click(screen.getByRole('button', { name: /top left/i }))
    expect(axi.setWebcam).toHaveBeenCalledWith({ corner: 'tl' })
  })

  it('sends the mirror toggle', async () => {
    const axi = api()
    render(<WebcamSettings webcam={view({ enabled: true, deviceId: '/dev/video0' })} axi={axi} />)
    await userEvent.click(screen.getByLabelText(/mirror/i))
    expect(axi.setWebcam).toHaveBeenCalledWith({ mirrored: true })
  })

  it('shows an unavailable warning when the camera is gone', () => {
    render(<WebcamSettings webcam={view({ enabled: true, deviceId: '/dev/video0', available: false })} axi={api()} />)
    expect(screen.getByText(/unavailable/i)).toBeTruthy()
  })

  it('does not fetch properties until a device is selected', async () => {
    const axi = api()
    render(<WebcamSettings webcam={view({ enabled: true })} axi={axi} />)
    await waitFor(() => expect(axi.getWebcamDevices).toHaveBeenCalled())
    expect(axi.getWebcamProps).not.toHaveBeenCalled()
  })

  it('fetches properties once a device is selected', async () => {
    const axi = api()
    render(<WebcamSettings webcam={view({ enabled: true, deviceId: '/dev/video0' })} axi={axi} />)
    await waitFor(() => expect(axi.getWebcamProps).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w @axistream/app run test -- webcam-settings`
Expected: FAIL — cannot resolve `WebcamSettings.js`.

- [ ] **Step 3: Implement `WebcamSettings.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { AudioDevice, AxiApi, WebcamCorner, WebcamProps, WebcamView } from '../../shared/state.js'
import { WEBCAM_MIN_SIZE_PCT, WEBCAM_MAX_SIZE_PCT } from '../../shared/state.js'

const CORNERS: { value: WebcamCorner; label: string }[] = [
  { value: 'tl', label: 'Top left' },
  { value: 'tr', label: 'Top right' },
  { value: 'bl', label: 'Bottom left' },
  { value: 'br', label: 'Bottom right' },
]

const EMPTY_PROPS: WebcamProps = { pixelformats: [], resolutions: [], framerates: [] }

export function WebcamSettings({ webcam, axi }: { webcam: WebcamView; axi: AxiApi }) {
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [props, setProps] = useState<WebcamProps>(EMPTY_PROPS)

  useEffect(() => { void axi.getWebcamDevices().then(setDevices) }, [axi])

  // The three property lists are dependent — OBS recomputes framerates from
  // the current resolution — so they are re-fetched after every mode change
  // rather than cached.
  useEffect(() => {
    if (!webcam.deviceId) { setProps(EMPTY_PROPS); return }
    void axi.getWebcamProps().then(setProps)
  }, [axi, webcam.deviceId, webcam.mode])

  const manual = webcam.mode !== null
  const setMode = (patch: Partial<NonNullable<WebcamView['mode']>>) => {
    const base = webcam.mode ?? {
      pixelformat: props.pixelformats[0]?.value ?? '',
      resolution: props.resolutions[0]?.value ?? '',
      framerate: props.framerates[0]?.value ?? '',
    }
    void axi.setWebcam({ mode: { ...base, ...patch } })
  }

  return (
    <>
      <h3>Camera</h3>
      <label>
        <input
          type="checkbox"
          checked={webcam.enabled}
          onChange={(e) => void axi.setWebcam({ enabled: e.target.checked })}
        />
        Show my camera on stream
      </label>

      <label>
        Camera
        <select
          value={webcam.deviceId ?? ''}
          onChange={(e) => {
            const id = e.target.value || null
            const name = devices.find((d) => d.id === id)?.name ?? null
            void axi.setWebcam({ deviceId: id, deviceLabel: name, mode: null })
          }}
        >
          <option value="">Select a camera…</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>

      {webcam.enabled && webcam.deviceId && !webcam.available && (
        <p className="muted">Camera unavailable — the stream continues without it.</p>
      )}

      <div className="webcam-corners">
        {CORNERS.map((c) => (
          <button
            key={c.value}
            className={webcam.corner === c.value ? 'btn' : 'btn ghost'}
            onClick={() => void axi.setWebcam({ corner: c.value })}
          >{c.label}</button>
        ))}
      </div>

      <label>
        Size
        <input
          type="range"
          min={Math.round(WEBCAM_MIN_SIZE_PCT * 100)}
          max={Math.round(WEBCAM_MAX_SIZE_PCT * 100)}
          value={Math.round(webcam.sizePct * 100)}
          onChange={(e) => void axi.setWebcam({ sizePct: Number(e.target.value) / 100 })}
        />
        <span className="muted">{Math.round(webcam.sizePct * 100)}%</span>
      </label>

      <label>
        <input
          type="checkbox"
          checked={webcam.mirrored}
          onChange={(e) => void axi.setWebcam({ mirrored: e.target.checked })}
        />
        Mirror my camera
      </label>

      <label>
        <input
          type="checkbox"
          checked={manual}
          onChange={(e) => e.target.checked ? setMode({}) : void axi.setWebcam({ mode: null })}
        />
        Choose the camera format manually
      </label>

      {manual && (
        <div className="webcam-modes">
          <label>
            Format
            <select value={webcam.mode?.pixelformat ?? ''} onChange={(e) => setMode({ pixelformat: e.target.value })}>
              {props.pixelformats.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label>
            Resolution
            <select value={webcam.mode?.resolution ?? ''} onChange={(e) => setMode({ resolution: e.target.value })}>
              {props.resolutions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label>
            Frame rate
            <select value={webcam.mode?.framerate ?? ''} onChange={(e) => setMode({ framerate: e.target.value })}>
              {props.framerates.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 4: Mount it in `SettingsScreen.tsx`**

Add the import beside the others, and insert a new section between the Audio section and the Quality section:

```tsx
          <section className="setting">
            <WebcamSettings webcam={state.webcam} axi={axi} />
          </section>
```

- [ ] **Step 5: Add the two layout classes to `styles.css`**

```css
.webcam-corners { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 8px 0; }
.webcam-modes { display: grid; gap: 6px; margin-top: 8px; }
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm -w @axistream/app run test -- webcam-settings settings-screen`
Expected: PASS. If the existing `settings-screen` test asserts a section count or ordering, update that assertion to include Camera.

- [ ] **Step 7: Typecheck and commit**

```bash
cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..
git add packages/app/src/renderer/components/WebcamSettings.tsx packages/app/src/renderer/components/SettingsScreen.tsx packages/app/src/renderer/styles.css packages/app/test/webcam-settings.test.tsx packages/app/test/settings-screen.test.tsx
git commit -m "feat(webcam): settings UI"
```

---

## Task 8: Stream-screen quick toggle

**Files:**
- Modify: `packages/app/src/renderer/components/StreamScreen.tsx`
- Test: `packages/app/test/stream-screen.test.tsx`

**Interfaces:**
- Consumes: `AppState['webcam']`, `AxiApi.setWebcam` (Tasks 1, 5).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/test/stream-screen.test.tsx`, matching that file's existing render helper and state factory rather than inventing new ones:

```tsx
describe('webcam quick toggle', () => {
  it('is hidden when no camera has been configured', () => {
    renderStream({ webcam: { ...DEFAULT_WEBCAM, available: true } })
    expect(screen.queryByRole('button', { name: /camera/i })).toBeNull()
  })

  it('toggles the camera off when it is on', async () => {
    const axi = makeAxi()
    renderStream({ webcam: { ...DEFAULT_WEBCAM, enabled: true, deviceId: '/dev/video0', available: true } }, axi)
    await userEvent.click(screen.getByRole('button', { name: /camera/i }))
    expect(axi.setWebcam).toHaveBeenCalledWith({ enabled: false })
  })
})
```

Add `DEFAULT_WEBCAM` to the file's `../src/shared/state.js` import, and add `setWebcam: vi.fn(async () => {})` to that file's axi factory. If the factory builds state from `INITIAL_STATE`, `webcam` is already present from Task 1 and no other test needs changing.

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w @axistream/app run test -- stream-screen`
Expected: FAIL — no button matching /camera/i.

- [ ] **Step 3: Add the toggle**

Beside the existing quick toggles (near the `masksVisible` control around line 111), add:

```tsx
          {state.webcam.deviceId && (
            <button
              className={state.webcam.enabled ? 'btn' : 'btn ghost'}
              onClick={() => void axi.setWebcam({ enabled: !state.webcam.enabled })}
            >{state.webcam.enabled ? 'Camera on' : 'Camera off'}</button>
          )}
```

The toggle is hidden until a camera has been chosen — an on/off control for a device that does not exist is noise on the main screen.

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w @axistream/app run test -- stream-screen`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..
git add packages/app/src/renderer/components/StreamScreen.tsx packages/app/test/stream-screen.test.tsx
git commit -m "feat(webcam): stream-screen quick toggle"
```

---

## Task 9: Full verification and manual smoke

**Files:**
- Modify: `README.md` (feature list only)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Run every gate**

```bash
npm -w @axistream/app run test
npm -w @axistream/capture run test
cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..
```

Expected: all green. The app suite should be at least 20 tests above its pre-branch count.

- [ ] **Step 2: Confirm no test file is untracked**

```bash
git status --porcelain -uall
```

Expected: empty. A previous sub-project nearly merged with a whole test file untracked and therefore never run in CI.

- [ ] **Step 3: Verify all three rebuild hooks are present**

```bash
grep -n "applyWebcam()" packages/app/src/main/index.ts
```

Expected: at least four hits — the boot call plus one inside each of `provision`, `repairCapture`, and `switchSource`. Fewer than four means the scene-rebuild landmine is live and the camera will silently disappear after a capture repair.

- [ ] **Step 4: Add the feature to the README list**

Add a bullet to the feature list matching the surrounding style, e.g. `- **Webcam** — a camera in any corner, sized and optionally mirrored.`

- [ ] **Step 5: Manual smoke (requires a real camera and OBS)**

This cannot be automated; run it before merging.

1. Camera appears in the preview once enabled, in the selected corner.
2. All four corners place it correctly, inside the margin.
3. The size slider resizes it and it stays inside the canvas at both extremes.
4. Mirror flips the image **and the image does not jump horizontally** — this is the placement bug the arithmetic guards against.
5. Manual format: pick a pixel format, confirm the resolution list changes; pick a resolution, confirm the frame-rate list changes.
6. Unplug the camera mid-stream: the stream keeps running, a chip appears, exactly one toast fires.
7. Re-plug and re-select: the camera returns.
8. Run **Re-set up capture** while the camera is on — it must still be composited afterward. This is the rebuild landmine; if it fails here, Step 3's grep missed a site.
9. Switch source while the camera is on — same expectation.
10. Go live with the camera on and confirm it is in the YouTube stream, not just the local preview.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: note webcam source in the README feature list"
```

---

## Self-Review Notes

Checked against the spec:

- Device selection, enable/disable, four corners, size, mirror, mode override, unavailable condition — Tasks 1-8.
- `kindsFor` platform map with the untested win32 branch — Task 3, tested.
- Scene-rebuild re-add — Task 3 (unit) and Task 6 Step 6 + Task 9 Step 3 (wiring), with a grep-verifiable count.
- Z-order pin — Task 3.
- Mirror origin offset — Task 2, with a dedicated test and a manual smoke item.
- `available` as condition + edge-only toast — Task 6, via a pure `webcamToast`.
- Out-of-scope items (free drag, shapes, multiple cameras, busy-camera detection) have no tasks, as intended.
