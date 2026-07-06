# Privacy Masks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User-positioned static privacy masks — solid rectangles drawn on the preview and composited over the capture in OBS, so chat/DMs never reach the stream.

**Architecture:** A `MaskController` (main process) reconciles `color_source_v3` inputs in OBS scene `Main` against a persisted `MaskRect[]` (normalized 0–1 canvas coordinates in `StreamSettings`). The renderer gets a `MaskEditor` overlay on the preview (add/drag/resize/delete), committing the full array over one `setMasks` IPC channel. Masks are re-applied at every point the scene can be rebuilt (boot, provision, repair, switch source). Spec: `docs/superpowers/specs/2026-07-06-privacy-masks-design.md`.

**Tech Stack:** Electron 31, React 18, TypeScript 5.5, Vitest 2, obs-websocket-js 5 (via existing sidecar client).

## Global Constraints

- No new dependencies.
- Code style: 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on relative imports (ESM/NodeNext).
- All OBS calls best-effort: `console.warn` and continue; a mask failure must never block go-live or boot.
- Tests: `npm -w @axistream/app run test` (vitest fork pool, maxForks 2 — already configured; do not raise). Typecheck gate: `cd packages/app && npx tsc --noEmit -p tsconfig.json` (must be zero errors at the end of Tasks 5–7; Tasks 2–4 may leave `index.ts`/`preload` red only where a later task completes the wiring — note it in the report).
- Constants (exact values): `MASK_PREFIX = 'AxiStream Mask '`, `MASK_COLOR = 0xff15110f` (OBS ABGR for opaque RGB `#0f1115`), `MAX_MASKS = 8`, scene name `'Main'`, input kind `'color_source_v3'`.
- `MaskRect` fields are normalized 0–1 relative to the OBS base canvas: `x/y` clamp 0–1, `w/h` clamp 0.01–1.

---

## File Structure

**New:**
- `packages/app/src/main/MaskController.ts` — OBS reconcile (Task 1)
- `packages/app/src/renderer/cover-transform.ts` — pure object-fit:cover math (Task 6)
- `packages/app/src/renderer/components/MaskEditor.tsx` — edit overlay (Task 7)
- Tests: `packages/app/test/mask-controller.test.ts`, `cover-transform.test.ts`, `mask-editor.test.tsx`

**Modified:**
- `packages/app/src/shared/state.ts` — `MaskRect`, `MAX_MASKS`, `AppState.masks`, `CH.setMasks`, `AxiApi.setMasks` (Task 3)
- `packages/app/src/main/StreamSettings.ts` — persist + sanitize `masks` (Task 2)
- `packages/app/src/main/ipc.ts`, `src/preload/index.ts` (Task 4)
- `packages/app/src/main/index.ts` — construct + wire + re-apply points (Task 5)
- `packages/app/src/renderer/components/StreamScreen.tsx`, `src/renderer/styles.css` (Task 7)

---

### Task 1: MaskController

**Files:**
- Create: `packages/app/src/main/MaskController.ts`
- Test: `packages/app/test/mask-controller.test.ts`

**Interfaces:**
- Consumes: sidecar client shape `{ call(req: string, data?: unknown): Promise<any> }` (same as `AudioController`). `MaskRect` is defined locally in this file for now (keeps this task self-contained and green); Task 3 moves it to `shared/state.ts` and this file re-imports + re-exports it.

- Produces: `class MaskController { constructor(d: { client(): { call(req: string, data?: unknown): Promise<any> } }); applyMasks(masks: MaskRect[]): Promise<void> }`, constants `MASK_PREFIX`, `MASK_COLOR`, `MAX_MASKS`.

- [ ] **Step 1: Write the failing test**

`packages/app/test/mask-controller.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { MaskController, MASK_PREFIX, MASK_COLOR, type MaskRect } from '../src/main/MaskController.js'

const CANVAS = { baseWidth: 2000, baseHeight: 1000 }

function recorder(opts: { inputs?: string[]; canvas?: object | null; failGetItemFor?: string[] } = {}) {
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
    await new MaskController({ client: r.client }).applyMasks([mask('a')])
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
    await new MaskController({ client: r.client }).applyMasks([mask('a', 0, 0, 0.5, 0.5)])
    expect(r.calls.some((c) => c.req === 'CreateInput')).toBe(false)
    const set = r.calls.find((c) => c.req === 'SetInputSettings')
    expect(set?.data).toEqual({ inputName: `${MASK_PREFIX}a`, inputSettings: { color: MASK_COLOR, width: 1000, height: 500 }, overlay: true })
  })

  it('removes stale mask inputs but leaves other inputs alone', async () => {
    const r = recorder({ inputs: [`${MASK_PREFIX}old`, 'AxiStream Capture', 'AxiStream Mic'] })
    await new MaskController({ client: r.client }).applyMasks([])
    const removed = r.calls.filter((c) => c.req === 'RemoveInput').map((c) => c.data.inputName)
    expect(removed).toEqual([`${MASK_PREFIX}old`])
  })

  it('re-adds the scene item when the input survives a scene rebuild', async () => {
    const r = recorder({ inputs: [`${MASK_PREFIX}a`], failGetItemFor: [`${MASK_PREFIX}a`] })
    await new MaskController({ client: r.client }).applyMasks([mask('a')])
    const createItem = r.calls.find((c) => c.req === 'CreateSceneItem')
    expect(createItem?.data).toEqual({ sceneName: 'Main', sourceName: `${MASK_PREFIX}a` })
    expect(r.calls.some((c) => c.req === 'SetSceneItemTransform')).toBe(true)
  })

  it('skips silently when the canvas is unreadable', async () => {
    const r = recorder({ canvas: null })
    await expect(new MaskController({ client: r.client }).applyMasks([mask('a')])).resolves.toBeUndefined()
    expect(r.calls.filter((c) => c.req !== 'GetVideoSettings')).toEqual([])
  })

  it('swallows client errors entirely', async () => {
    const client = () => ({ call: vi.fn(async () => { throw new Error('boom') }) })
    await expect(new MaskController({ client }).applyMasks([mask('a')])).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @axistream/app run test -- test/mask-controller.test.ts`
Expected: FAIL — cannot resolve `../src/main/MaskController.js`

- [ ] **Step 3: Write the implementation**

`packages/app/src/main/MaskController.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @axistream/app run test -- test/mask-controller.test.ts`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/MaskController.ts packages/app/test/mask-controller.test.ts
git commit -m "feat(masks): MaskController reconciles OBS color-source overlays"
```

---

### Task 2: StreamSettings persists masks

**Files:**
- Modify: `packages/app/src/main/StreamSettings.ts`
- Test: `packages/app/test/stream-settings.test.ts` (append)

**Interfaces:**
- Consumes: `MaskRect`, `MAX_MASKS` from `../src/main/MaskController.js` (Task 3 re-points the import to shared state).
- Produces: `StreamSettingsData.masks: MaskRect[]` (default `[]`), sanitized on `load()`.

- [ ] **Step 1: Write the failing tests** — append to `packages/app/test/stream-settings.test.ts` (match its existing tmp-file setup helpers; it writes JSON to a temp path and constructs `new StreamSettings(path)`):

```ts
describe('masks', () => {
  it('defaults to [] and round-trips', () => {
    const s = makeSettings() // reuse the file's existing temp-path helper
    expect(s.load().masks).toEqual([])
    s.patch({ masks: [{ id: 'a', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }] })
    expect(s.load().masks).toEqual([{ id: 'a', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }])
  })

  it('drops invalid entries and clamps values on load', () => {
    const s = makeSettings()
    writeRaw(s, { masks: [
      { id: 'ok', x: -1, y: 2, w: 0, h: 5 },
      { id: 42, x: 0, y: 0, w: 0.1, h: 0.1 },
      { id: 'nan', x: NaN, y: 0, w: 0.1, h: 0.1 },
      'garbage',
    ] })
    expect(s.load().masks).toEqual([{ id: 'ok', x: 0, y: 1, w: 0.01, h: 1 }])
  })

  it('caps at MAX_MASKS entries', () => {
    const s = makeSettings()
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, x: 0, y: 0, w: 0.1, h: 0.1 }))
    writeRaw(s, { masks: many })
    expect(s.load().masks).toHaveLength(8)
  })

  it('non-array masks falls back to []', () => {
    const s = makeSettings()
    writeRaw(s, { masks: 'nope' })
    expect(s.load().masks).toEqual([])
  })
})
```

(Adapt `makeSettings`/`writeRaw` to the helpers the file actually uses — if it has none, write the raw JSON with `writeFileSync(path, JSON.stringify(obj))`. Note: `NaN` doesn't survive `JSON.stringify` — write that case's file content as a string literal: `'{"masks":[{"id":"nan","x":null,"y":0,"w":0.1,"h":0.1}]}'`.)

- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/app run test -- test/stream-settings.test.ts` → FAIL (masks undefined)

- [ ] **Step 3: Implement** in `StreamSettings.ts`:

```ts
import { MAX_MASKS, type MaskRect } from './MaskController.js'
```

Add `masks: MaskRect[]` to `StreamSettingsData`; `masks: []` to `DEFAULT_SETTINGS`. Add above the class:

```ts
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function sanitizeMasks(raw: unknown): MaskRect[] {
  if (!Array.isArray(raw)) return []
  const out: MaskRect[] = []
  for (const m of raw) {
    if (out.length >= MAX_MASKS) break
    if (typeof m !== 'object' || m === null) continue
    const { id, x, y, w, h } = m as Record<string, unknown>
    if (typeof id !== 'string' || !id) continue
    if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) continue
    out.push({ id, x: clamp(x as number, 0, 1), y: clamp(y as number, 0, 1), w: clamp(w as number, 0.01, 1), h: clamp(h as number, 0.01, 1) })
  }
  return out
}
```

In `load()`'s return object add: `masks: sanitizeMasks(raw.masks),`

- [ ] **Step 4: Run to verify pass** — `npm -w @axistream/app run test -- test/stream-settings.test.ts` → all pass

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/StreamSettings.ts packages/app/test/stream-settings.test.ts
git commit -m "feat(settings): persist privacy masks with sanitizing load"
```

---

### Task 3: Shared state — MaskRect, AppState.masks, channel, AxiApi

**Files:**
- Modify: `packages/app/src/shared/state.ts`, `packages/app/src/main/MaskController.ts`, `packages/app/src/main/StreamSettings.ts`
- Test: existing suites keep passing (this task moves a type; behavior unchanged)

**Interfaces:**
- Produces: in `shared/state.ts` —

```ts
export interface MaskRect { id: string; x: number; y: number; w: number; h: number }
export const MAX_MASKS = 8
// AppState gains:  masks: MaskRect[]        (INITIAL_STATE.masks = [])
// CH gains:        setMasks: 'axi:setMasks'
// AxiApi gains:    setMasks(masks: MaskRect[]): Promise<void>
```

- [ ] **Step 1: Move the type.** In `shared/state.ts` add `MaskRect`, `MAX_MASKS`, `masks: MaskRect[]` on `AppState`, `masks: []` in `INITIAL_STATE`, `setMasks: 'axi:setMasks'` in `CH`, and `setMasks(masks: MaskRect[]): Promise<void>` in `AxiApi`.
- [ ] **Step 2:** In `MaskController.ts` delete the local `MaskRect` interface and `MAX_MASKS` const; replace with `import { MAX_MASKS, type MaskRect } from '../shared/state.js'` and re-export both (`export { MAX_MASKS, type MaskRect }`) so Task 1/2 test imports keep working.
- [ ] **Step 3:** In `StreamSettings.ts` change the import to `from '../shared/state.js'`.
- [ ] **Step 4: Verify.** `npm -w @axistream/app run test -- test/mask-controller.test.ts test/stream-settings.test.ts test/store.test.ts` → pass. Typecheck (`cd packages/app && npx tsc --noEmit -p tsconfig.json`) will be red ONLY in `preload/index.ts` (AxiApi missing `setMasks`) until Task 4 — confirm no other errors and note it in your report.
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/main/MaskController.ts packages/app/src/main/StreamSettings.ts
git commit -m "feat(state): masks field, setMasks channel and AxiApi method"
```

---

### Task 4: IPC + preload

**Files:**
- Modify: `packages/app/src/main/ipc.ts`, `packages/app/src/preload/index.ts`
- Test: `packages/app/test/ipc-contract.test.ts` (append channel)

**Interfaces:**
- Consumes: `CH.setMasks`, `MaskRect` (Task 3).
- Produces: `IpcHandlers.setMasks(masks: MaskRect[]): Promise<void>`; preload `api.setMasks`.

- [ ] **Step 1: Failing test** — in `ipc-contract.test.ts`, add `CH.setMasks` to the `commandChannels` array in the first test.
- [ ] **Step 2:** Run `npm -w @axistream/app run test -- test/ipc-contract.test.ts` → FAIL (`handled.has` false)
- [ ] **Step 3: Implement.**
  - `ipc.ts`: import `type MaskRect`; add `setMasks(masks: MaskRect[]): Promise<void>` to `IpcHandlers`; add `ipcMain.handle(CH.setMasks, (_e: unknown, masks: MaskRect[]) => handlers.setMasks(masks))` alongside the other setters.
  - `preload/index.ts`: add `setMasks: (masks) => ipcRenderer.invoke(CH.setMasks, masks) as Promise<void>,`
- [ ] **Step 4:** `npm -w @axistream/app run test -- test/ipc-contract.test.ts` → pass. Typecheck: `preload` is now green; `main/index.ts` is red (handlers object missing `setMasks`) until Task 5 — confirm that's the only error.
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/ipc.ts packages/app/src/preload/index.ts packages/app/test/ipc-contract.test.ts
git commit -m "feat(ipc): setMasks channel + preload method"
```

---

### Task 5: Main-process wiring

**Files:**
- Modify: `packages/app/src/main/index.ts`
- Test: whole suite + typecheck (index.ts has no unit harness; the seams it calls are tested in Tasks 1–4)

**Interfaces:**
- Consumes: `MaskController` (Task 1), `settings.patch({ masks })` (Task 2), `IpcHandlers.setMasks` (Task 4), `MAX_MASKS` (Task 3).

- [ ] **Step 1: Wire it.** In `packages/app/src/main/index.ts`:
  - Import: `import { MaskController } from './MaskController.js'` and add `MAX_MASKS` + `type MaskRect` to the `../shared/state.js` import.
  - After `const audio = new AudioController(...)`: `const maskCtl = new MaskController({ client: () => sidecar.client() })`
  - Add handler (next to the audio setters):

```ts
setMasks: async (masks: MaskRect[]) => {
  const next = masks.slice(0, MAX_MASKS)
  settings.patch({ masks: next })
  await maskCtl.applyMasks(next)
  setState({ masks: next })
},
```

  - Re-apply after every capture (re)build — in each of `provision`, `repairCapture`, and `switchSource` handlers, immediately after the existing `startVirtualCam()` call add: `await maskCtl.applyMasks(settings.load().masks)`
  - Boot (provisioned branch), after the audio `applySettings` call:

```ts
setState({ masks: settings.load().masks })
await maskCtl.applyMasks(settings.load().masks)
```

- [ ] **Step 2: Typecheck** — `cd packages/app && npx tsc --noEmit -p tsconfig.json` → zero errors (the Task 3/4 staged gaps close here).
- [ ] **Step 3: Full suite** — `npm -w @axistream/app run test` → all pass.
- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main/index.ts
git commit -m "feat(main): wire mask controller — setMasks handler + re-apply on boot/rebuild"
```

---

### Task 6: cover-transform (pure renderer math)

**Files:**
- Create: `packages/app/src/renderer/cover-transform.ts`
- Test: `packages/app/test/cover-transform.test.ts`

**Interfaces:**
- Produces: `interface CoverRect { left: number; top: number; width: number; height: number }`; `coverContentRect(videoW, videoH, elemW, elemH): CoverRect` — the element-pixel rect the video content occupies under `object-fit: cover` (may extend beyond the element; that's the crop). Any non-positive dimension → fallback `{ left: 0, top: 0, width: elemW, height: elemH }`.

- [ ] **Step 1: Failing test** — `packages/app/test/cover-transform.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { coverContentRect } from '../src/renderer/cover-transform.js'

describe('coverContentRect', () => {
  it('exact aspect match fills the element', () => {
    expect(coverContentRect(1920, 1080, 960, 540)).toEqual({ left: 0, top: 0, width: 960, height: 540 })
  })
  it('wider video crops left/right (negative left)', () => {
    // 21:9 video in a 16:9 element: scale by height, width overflows
    expect(coverContentRect(2100, 900, 800, 450)).toEqual({ left: -125, top: 0, width: 1050, height: 450 })
  })
  it('taller video crops top/bottom (negative top)', () => {
    expect(coverContentRect(900, 900, 800, 450)).toEqual({ left: 0, top: -175, width: 800, height: 800 })
  })
  it('degenerate dims fall back to the element box', () => {
    expect(coverContentRect(0, 0, 800, 450)).toEqual({ left: 0, top: 0, width: 800, height: 450 })
  })
})
```

- [ ] **Step 2:** Run `npm -w @axistream/app run test -- test/cover-transform.test.ts` → FAIL (module missing)
- [ ] **Step 3: Implement** — `packages/app/src/renderer/cover-transform.ts`:

```ts
export interface CoverRect { left: number; top: number; width: number; height: number }

/** Element-pixel rect that a video's content occupies under object-fit: cover.
 *  May extend beyond the element (negative left/top) — that's the crop. */
export function coverContentRect(videoW: number, videoH: number, elemW: number, elemH: number): CoverRect {
  if (!(videoW > 0) || !(videoH > 0) || !(elemW > 0) || !(elemH > 0)) return { left: 0, top: 0, width: elemW, height: elemH }
  const scale = Math.max(elemW / videoW, elemH / videoH)
  const width = videoW * scale
  const height = videoH * scale
  return { left: (elemW - width) / 2, top: (elemH - height) / 2, width, height }
}
```

- [ ] **Step 4:** `npm -w @axistream/app run test -- test/cover-transform.test.ts` → 4 passed
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/renderer/cover-transform.ts packages/app/test/cover-transform.test.ts
git commit -m "feat(ui): object-fit cover content-rect helper"
```

---

### Task 7: MaskEditor overlay + StreamScreen integration

**Files:**
- Create: `packages/app/src/renderer/components/MaskEditor.tsx`
- Modify: `packages/app/src/renderer/components/StreamScreen.tsx`, `packages/app/src/renderer/styles.css`
- Test: `packages/app/test/mask-editor.test.tsx`; update the `axi` mock in `packages/app/test/stream-screen.test.tsx` with a `setMasks: vi.fn()` stub and `masks: []` in its state fixture (its fixtures likely spread `INITIAL_STATE`, in which case only the mock stub is needed).

**Interfaces:**
- Consumes: `MaskRect`, `MAX_MASKS` (Task 3); `coverContentRect` (Task 6); `axi.setMasks` (Task 4).
- Produces: `MaskEditor({ masks, onCommit, onDone })` — local-state editor; calls `onCommit(full MaskRect[])` after every add/delete/drag-end; `onDone()` closes.

- [ ] **Step 1: Failing tests** — `packages/app/test/mask-editor.test.tsx` (match the render-test style of `audio-settings.test.tsx`: `@testing-library/react`, jsdom):

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MaskEditor } from '../src/renderer/components/MaskEditor.js'
import type { MaskRect } from '../src/shared/state.js'

const m = (id: string): MaskRect => ({ id, x: 0.1, y: 0.1, w: 0.2, h: 0.2 })

describe('MaskEditor', () => {
  it('renders a rect per mask', () => {
    render(<MaskEditor masks={[m('a'), m('b')]} onCommit={() => {}} onDone={() => {}} />)
    expect(screen.getAllByTestId('mask-rect')).toHaveLength(2)
  })

  it('Add mask appends and commits', () => {
    const onCommit = vi.fn()
    render(<MaskEditor masks={[]} onCommit={onCommit} onDone={() => {}} />)
    fireEvent.click(screen.getByText('Add mask'))
    expect(onCommit).toHaveBeenCalledTimes(1)
    const committed = onCommit.mock.calls[0][0] as MaskRect[]
    expect(committed).toHaveLength(1)
    expect(committed[0]).toMatchObject({ x: 0.375, y: 0.4, w: 0.25, h: 0.2 })
    expect(screen.getAllByTestId('mask-rect')).toHaveLength(1)
  })

  it('delete removes the mask and commits', () => {
    const onCommit = vi.fn()
    render(<MaskEditor masks={[m('a')]} onCommit={onCommit} onDone={() => {}} />)
    fireEvent.click(screen.getByLabelText('Delete mask'))
    expect(onCommit).toHaveBeenCalledWith([])
    expect(screen.queryAllByTestId('mask-rect')).toHaveLength(0)
  })

  it('Add is disabled at MAX_MASKS', () => {
    const masks = Array.from({ length: 8 }, (_, i) => m(`m${i}`))
    render(<MaskEditor masks={masks} onCommit={() => {}} onDone={() => {}} />)
    expect(screen.getByText('Add mask').closest('button')).toBeDisabled()
  })

  it('Done calls onDone', () => {
    const onDone = vi.fn()
    render(<MaskEditor masks={[]} onCommit={() => {}} onDone={onDone} />)
    fireEvent.click(screen.getByText('Done'))
    expect(onDone).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2:** Run `npm -w @axistream/app run test -- test/mask-editor.test.tsx` → FAIL (module missing)
- [ ] **Step 3: Implement** — `packages/app/src/renderer/components/MaskEditor.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { MAX_MASKS, type MaskRect } from '../../shared/state.js'
import { coverContentRect, type CoverRect } from '../cover-transform.js'

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const newId = () => Math.random().toString(36).slice(2, 10)

interface Drag { id: string; mode: 'move' | 'resize'; px: number; py: number; orig: MaskRect }

// Edit overlay for privacy masks. Coordinates are normalized (0–1) against
// the OBS canvas; the sibling preview <video> shows that canvas under
// object-fit: cover, so we map through its content rect to line up on screen.
// Local state is authoritative while editing; every add/delete/drag-end
// commits the full array upward (which persists + drives OBS live).
export function MaskEditor({ masks: initial, onCommit, onDone }: { masks: MaskRect[]; onCommit(masks: MaskRect[]): void; onDone(): void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [masks, setMasks] = useState<MaskRect[]>(initial)
  // Ref mirror so pointer-up commits the exact rects of the final move event,
  // not a possibly-stale render closure.
  const masksRef = useRef(masks)
  const update = (next: MaskRect[]) => { masksRef.current = next; setMasks(next) }
  const [drag, setDrag] = useState<Drag | null>(null)
  const [content, setContent] = useState<CoverRect | null>(null)

  useEffect(() => {
    const measure = () => {
      const el = boxRef.current
      if (!el) return
      const video = el.parentElement?.querySelector('video')
      setContent(coverContentRect(video?.videoWidth ?? 0, video?.videoHeight ?? 0, el.clientWidth, el.clientHeight))
    }
    measure()
    window.addEventListener('resize', measure)
    // The video's dimensions only exist once the virtual-cam feed is up, and
    // can change after an OBS restart — re-measure on a slow tick.
    const t = setInterval(measure, 1000)
    return () => { window.removeEventListener('resize', measure); clearInterval(t) }
  }, [])

  const rect = content ?? { left: 0, top: 0, width: 1, height: 1 }
  const commit = (next: MaskRect[]) => { update(next); onCommit(next) }

  const add = () => commit([...masksRef.current, { id: newId(), x: 0.375, y: 0.4, w: 0.25, h: 0.2 }])
  const remove = (id: string) => commit(masksRef.current.filter((m) => m.id !== id))

  const onPointerDown = (e: React.PointerEvent, id: string, mode: Drag['mode']) => {
    e.preventDefault(); e.stopPropagation()
    const orig = masks.find((m) => m.id === id)
    if (!orig) return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setDrag({ id, mode, px: e.clientX, py: e.clientY, orig })
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || !rect.width || !rect.height) return
    const dx = (e.clientX - drag.px) / rect.width
    const dy = (e.clientY - drag.py) / rect.height
    update(masksRef.current.map((m) => {
      if (m.id !== drag.id) return m
      if (drag.mode === 'move') {
        return { ...m, x: clamp(drag.orig.x + dx, 0, 1 - m.w), y: clamp(drag.orig.y + dy, 0, 1 - m.h) }
      }
      return { ...m, w: clamp(drag.orig.w + dx, 0.01, 1 - m.x), h: clamp(drag.orig.h + dy, 0.01, 1 - m.y) }
    }))
  }
  const onPointerUp = () => {
    if (!drag) return
    setDrag(null)
    onCommit(masksRef.current)
  }

  return (
    <div ref={boxRef} className="mask-editor" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div className="mask-toolbar">
        <button className="btn ghost xs" onClick={add} disabled={masks.length >= MAX_MASKS}><Plus size={12} /> Add mask</button>
        <span className="mask-hint">Drag to move · corner to resize · masks hide these areas on stream</span>
        <button className="btn primary xs" onClick={onDone}>Done</button>
      </div>
      {masks.map((m) => (
        <div key={m.id} data-testid="mask-rect" className="mask-rect"
          style={{ left: rect.left + m.x * rect.width, top: rect.top + m.y * rect.height, width: m.w * rect.width, height: m.h * rect.height }}
          onPointerDown={(e) => onPointerDown(e, m.id, 'move')}>
          <button className="mask-delete" aria-label="Delete mask" onPointerDown={(e) => e.stopPropagation()} onClick={() => remove(m.id)}><X size={11} /></button>
          <div className="mask-resize" onPointerDown={(e) => onPointerDown(e, m.id, 'resize')} />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: StreamScreen integration.** In `StreamScreen.tsx`:
  - Imports: add `Shield` to the lucide import, `import { useState } from 'react'`, `import { MaskEditor } from './MaskEditor.js'`.
  - Top of component: `const [editingMasks, setEditingMasks] = useState(false)`
  - In the `statusrow`, after the Switch source button (same live/approval gating expression — masks stay editable while live, hidden while `AWAITING_APPROVAL` switching):

```tsx
{phase === 'AWAITING_APPROVAL' ? null
  : <button className="btn ghost xs" onClick={() => setEditingMasks((v) => !v)} title="Black out chat or other areas on the stream"><Shield size={12} /> Masks</button>}
```

  - After the NEEDS_TITLE modal block:

```tsx
{editingMasks ? (
  <MaskEditor masks={state.masks} onCommit={(m) => axi.setMasks(m)} onDone={() => setEditingMasks(false)} />
) : null}
```

- [ ] **Step 5: CSS.** Append to `packages/app/src/renderer/styles.css`:

```css
/* Privacy-mask editor: sits over the preview video, under modals. */
.mask-editor { position: absolute; inset: 0; z-index: 4; overflow: hidden; touch-action: none; }
.mask-toolbar { position: absolute; top: 44px; left: 50%; transform: translateX(-50%); z-index: 6; display: flex; align-items: center; gap: 10px;
  background: rgba(13,15,20,.82); border: 1px solid rgba(255,255,255,.12); border-radius: 10px; padding: 6px 10px; backdrop-filter: blur(6px); }
.mask-hint { font-size: 11px; color: #8b95a5; white-space: nowrap; }
.mask-rect { position: absolute; z-index: 5; background: rgba(15,17,21,.78); border: 1.5px dashed rgba(34,211,238,.85); border-radius: 4px; cursor: move; }
.mask-delete { position: absolute; top: -9px; right: -9px; width: 18px; height: 18px; border-radius: 50%; border: 1px solid rgba(255,255,255,.25);
  background: #1a1e26; color: #c4cedb; display: grid; place-items: center; cursor: pointer; padding: 0; }
.mask-delete:hover { color: #fff; background: #2a2f3a; }
.mask-resize { position: absolute; right: -6px; bottom: -6px; width: 14px; height: 14px; border-radius: 3px; cursor: nwse-resize;
  background: rgba(34,211,238,.9); border: 1px solid rgba(13,15,20,.8); }
```

- [ ] **Step 6: Update the stream-screen test fixture** — in `packages/app/test/stream-screen.test.tsx`, add `setMasks: vi.fn()` to its `axi` mock (and `masks: []` to any hand-built state object that doesn't spread `INITIAL_STATE`).
- [ ] **Step 7: Run everything**

Run: `npm -w @axistream/app run test` → all pass, and `cd packages/app && npx tsc --noEmit -p tsconfig.json` → zero errors.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/renderer/components/MaskEditor.tsx packages/app/src/renderer/components/StreamScreen.tsx packages/app/src/renderer/styles.css packages/app/test/mask-editor.test.tsx packages/app/test/stream-screen.test.tsx
git commit -m "feat(ui): privacy-mask editor overlay on the stream preview"
```

---

## Final verification (whole branch)

- `npm -w @axistream/app run test` — full app suite green.
- `cd packages/app && npx tsc --noEmit -p tsconfig.json` — zero errors.
- Manual smoke (human): draw a mask over the GW2 chat box → shows in preview; survives app restart and Switch source; visible on a live YouTube stream.
