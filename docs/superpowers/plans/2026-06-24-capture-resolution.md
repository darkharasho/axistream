# Capture & Stream Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect the captured monitor's real resolution from OBS, set OBS's base canvas to match 1:1 and derive a 1440p-height-capped (aspect-preserving, ultrawide-safe) stream output, and feed the real numbers to the UI — replacing the hardcoded `1920×1080×60` capture meta.

**Architecture:** A new pure helper (`fitOutputResolution`) plus a side-effecting unit (`applyCaptureResolution`) live in `@axistream/capture` (`packages/capture/src/capture-resolution.ts`). The unit reads the capture source's native size from OBS via `GetSceneItemId`/`GetSceneItemTransform`, computes the output, and applies both base+output to OBS via `SetVideoSettings`. The Electron main process calls it on every path that reaches `READY` (provision, repair, boot-when-provisioned) and uses the result as the renderer's `CaptureMeta`.

**Tech Stack:** TypeScript ESM (`.js` import specifiers), Vitest (forks pool, maxForks 2), `obs-websocket-js` v5, Electron main process.

## Global Constraints

- TypeScript ESM: all relative imports use `.js` specifiers even for `.ts` files (e.g. `import { x } from './capture-resolution.js'`).
- Vitest runs via `npm test` (config sets `pool: 'forks'`, `maxForks: 2`). Do NOT pass `--maxWorkers` (throws on this vitest version).
- Capture-library unit tests live in `packages/capture/test/*.test.ts`; integration tests under `packages/capture/test/integration/**` are excluded from the default run.
- Policy (verbatim from spec): base canvas = monitor 1:1; output = scale so **height ≤ 1440**, preserve aspect ratio, **no width cap** (ultrawide keeps full width, never cropped); even dimensions; fps fixed at 60.
- `even(n) = Math.max(2, Math.floor(n / 2) * 2)`.
- `applyCaptureResolution` must NEVER throw and must return `null` on any failure or unreadable dims, leaving OBS untouched.
- Resolution is applied only when reaching `READY` (provision/repair/boot) — never during `LIVE`.

---

### Task 1: `capture-resolution` library unit

**Files:**
- Create: `packages/capture/src/capture-resolution.ts`
- Modify: `packages/capture/src/index.ts` (add one export line)
- Test: `packages/capture/test/capture-resolution.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. The injected `call` matches the shape of `obs-websocket-js`'s `OBSWebSocket.call(request, params)` — `(req: string, params?: object) => Promise<any>`.
- Produces (Task 2 relies on these exact names/types):
  - `interface OutputResolution { width: number; height: number }`
  - `function fitOutputResolution(w: number, h: number, maxHeight: number): OutputResolution | null`
  - `interface CaptureResolution { baseWidth: number; baseHeight: number; outputWidth: number; outputHeight: number; fps: number }`
  - `interface ResolutionDeps { call: <T = unknown>(req: string, params?: object) => Promise<T>; sceneName?: string; sourceName?: string; maxHeight?: number; fps?: number }`
  - `function applyCaptureResolution(deps: ResolutionDeps): Promise<CaptureResolution | null>`

- [ ] **Step 1: Write the failing test for `fitOutputResolution`**

Create `packages/capture/test/capture-resolution.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { fitOutputResolution, applyCaptureResolution } from '../src/capture-resolution.js'

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/capture && npm test -- capture-resolution`
Expected: FAIL — `fitOutputResolution` is not exported / module not found.

- [ ] **Step 3: Implement `fitOutputResolution`**

Create `packages/capture/src/capture-resolution.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify `fitOutputResolution` passes**

Run: `cd packages/capture && npm test -- capture-resolution`
Expected: PASS for the `fitOutputResolution` describe block (the `applyCaptureResolution` import resolves once the next step adds it; if the file errors on the missing export, proceed to Step 5 then re-run).

- [ ] **Step 5: Add the failing test for `applyCaptureResolution`**

Append to `packages/capture/test/capture-resolution.test.ts`:

```ts
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
    const res = await applyCaptureResolution({ call })
    expect(res).toEqual({ baseWidth: 3440, baseHeight: 1440, outputWidth: 3440, outputHeight: 1440, fps: 60 })
    expect(call).toHaveBeenCalledWith('GetSceneItemId', { sceneName: 'Main', sourceName: 'AxiStream Capture' })
    expect(call).toHaveBeenCalledWith('SetVideoSettings', {
      baseWidth: 3440, baseHeight: 1440, outputWidth: 3440, outputHeight: 1440,
      fpsNumerator: 60, fpsDenominator: 1,
    })
  })

  it('downscales a 4K source for the output but keeps base at native', async () => {
    const call = makeCall({ sourceWidth: 3840, sourceHeight: 2160 })
    const res = await applyCaptureResolution({ call })
    expect(res).toEqual({ baseWidth: 3840, baseHeight: 2160, outputWidth: 2560, outputHeight: 1440, fps: 60 })
  })

  it('returns null and does NOT call SetVideoSettings when dims are unreadable', async () => {
    const call = makeCall({ sourceWidth: 0, sourceHeight: 0 })
    const res = await applyCaptureResolution({ call })
    expect(res).toBeNull()
    expect(call).not.toHaveBeenCalledWith('SetVideoSettings', expect.anything())
  })

  it('returns null and never throws when a call rejects', async () => {
    const call = vi.fn(async () => { throw new Error('not connected') })
    await expect(applyCaptureResolution({ call })).resolves.toBeNull()
  })
})
```

- [ ] **Step 6: Run the test to verify the new cases fail**

Run: `cd packages/capture && npm test -- capture-resolution`
Expected: FAIL — `applyCaptureResolution` is not implemented.

- [ ] **Step 7: Implement `applyCaptureResolution`**

Append to `packages/capture/src/capture-resolution.ts`:

```ts
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
```

- [ ] **Step 8: Run the full capture-resolution test file**

Run: `cd packages/capture && npm test -- capture-resolution`
Expected: PASS — all `fitOutputResolution` and `applyCaptureResolution` cases green.

- [ ] **Step 9: Export from the barrel**

Modify `packages/capture/src/index.ts` — add this line (alphabetical position, after `./capture-config.js`):

```ts
export * from './capture-resolution.js'
```

- [ ] **Step 10: Run the whole capture suite to confirm nothing regressed**

Run: `cd packages/capture && npm test`
Expected: PASS — all existing tests plus the new file (integration excluded by config).

- [ ] **Step 11: Commit**

```bash
git add packages/capture/src/capture-resolution.ts packages/capture/src/index.ts packages/capture/test/capture-resolution.test.ts
git commit -m "feat(capture): detect monitor res + apply OBS base/output video settings"
```

---

### Task 2: Wire real resolution into the app

**Files:**
- Modify: `packages/app/src/main/index.ts` (import; add `applyResolution` helper; replace 3 hardcoded `capture:` literals)

**Interfaces:**
- Consumes from Task 1: `applyCaptureResolution(deps: ResolutionDeps): Promise<CaptureResolution | null>` exported from `@axistream/capture`. `sidecar.client()` returns the `OBSWebSocket` whose `.call(req, params)` matches `ResolutionDeps.call`.
- Produces: a local `applyResolution(): Promise<CaptureMeta>` helper used by the provision/repair handlers and the boot branch. `CaptureMeta` is the existing `{ sourceLabel: string; width: number; height: number; fps: number }` from `../shared/state.js`.

**Note on testing:** this task has no unit test (the wiring is in the Electron main entrypoint, which has no harness; it is covered by the existing e2e shell smoke and manual run). The verification step is a typecheck + smoke run.

- [ ] **Step 1: Add the import**

Modify `packages/app/src/main/index.ts` — extend the existing `@axistream/capture` import (currently line 24) to include `applyCaptureResolution`:

```ts
import { ObsSidecar, Provisioner, FlatpakObsLauncher, HeadlessCageObsLauncher, CaptureConfig, applyCaptureResolution } from '@axistream/capture'
```

Also ensure `CaptureMeta` is importable from shared state — change the existing shared-state import (line 30) to add the type:

```ts
import { CH, INITIAL_STATE, type AppState, type CaptureMeta } from '../shared/state.js'
```

- [ ] **Step 2: Add the `applyResolution` helper**

Modify `packages/app/src/main/index.ts` — directly after the `startVirtualCam` definition (currently line 101, inside `app.whenReady().then` so `sidecar` is in scope), add:

```ts
  // Detect the captured monitor's real resolution, apply base/output canvas to
  // OBS, and return the meta for the UI. Falls back to 1080p if dims are
  // unreadable (capture not yet rendering) — never blocks the path to READY.
  const applyResolution = async (): Promise<CaptureMeta> => {
    const res = await applyCaptureResolution({ call: (r, p) => sidecar.client().call(r as never, p as never) })
    return res
      ? { sourceLabel: 'Guild Wars 2', width: res.baseWidth, height: res.baseHeight, fps: res.fps }
      : { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, fps: 60 }
  }
```

- [ ] **Step 3: Replace the hardcoded meta in the `provision` handler**

Modify `packages/app/src/main/index.ts` — in the `provision` handler (currently line 105). Replace:

```ts
    provision: async () => { const ok = await capture.provision(); if (ok) { setState({ phase: goReadyPhase(), keyMasked: keyStore.masked(), capture: { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, fps: 60 } }); startVirtualCam() } },
```

with (apply resolution BEFORE startVirtualCam so the virtual cam reflects the corrected canvas):

```ts
    provision: async () => { const ok = await capture.provision(); if (ok) { const capture_ = await applyResolution(); setState({ phase: goReadyPhase(), keyMasked: keyStore.masked(), capture: capture_ }); startVirtualCam() } },
```

- [ ] **Step 4: Replace the hardcoded meta in the `repairCapture` handler**

Modify `packages/app/src/main/index.ts` — in the `repairCapture` handler (currently line 110). Replace:

```ts
    repairCapture: async () => { setState({ phase: 'SETTING_UP' }); const ok = await capture.repair(); if (ok) { setState({ phase: goReadyPhase(), keyMasked: keyStore.masked(), capture: { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, fps: 60 } }); startVirtualCam() } },
```

with:

```ts
    repairCapture: async () => { setState({ phase: 'SETTING_UP' }); const ok = await capture.repair(); if (ok) { const capture_ = await applyResolution(); setState({ phase: goReadyPhase(), keyMasked: keyStore.masked(), capture: capture_ }); startVirtualCam() } },
```

- [ ] **Step 5: Replace the hardcoded meta in the boot-when-provisioned branch**

Modify `packages/app/src/main/index.ts` — in the boot block (currently line 137). Replace:

```ts
    if (provisioned) {
      setState({ phase: keyStore.masked() ? 'READY' : 'NEEDS_KEY', keyMasked: keyStore.masked(), capture: { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, fps: 60 } })
      startVirtualCam()
    } else {
```

with:

```ts
    if (provisioned) {
      const capture_ = await applyResolution()
      setState({ phase: keyStore.masked() ? 'READY' : 'NEEDS_KEY', keyMasked: keyStore.masked(), capture: capture_ })
      startVirtualCam()
    } else {
```

- [ ] **Step 6: Typecheck the app package**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` (use the app's existing typecheck script if present — check `package.json` `scripts` for `typecheck`/`build` and prefer that).
Expected: no type errors. (If `CaptureMeta` was already imported, drop the duplicate from Step 1.)

- [ ] **Step 7: Run the app's test suite (e2e shell smoke)**

Run: `cd packages/app && npm test`
Expected: PASS — existing main/renderer tests and the e2e shell smoke still green (no test asserts the hardcoded 1080p meta; if one does, update it to accept the real/fallback meta).

- [ ] **Step 8: Manual smoke (local, with real OBS)**

Run the app (`npm run dev` from `packages/app`, or the project's documented dev command). On a non-1080p monitor, confirm the Stream-screen pill reads the real resolution (e.g. `Guild Wars 2 · 3440×1440 · 60fps`) once capture is READY. If OBS isn't reachable, the pill falls back to `1920×1080` — that is expected, not a failure.

- [ ] **Step 9: Commit**

```bash
git add packages/app/src/main/index.ts
git commit -m "feat(app): apply real monitor resolution to OBS + UI meta on READY"
```

---

## Self-Review

**1. Spec coverage:**
- "Detect real monitor res from OBS" → Task 1 Step 7 (`GetSceneItemId`/`GetSceneItemTransform`). ✓
- "Base canvas = monitor 1:1" → Task 1 `SetVideoSettings` `baseWidth/baseHeight = source dims`. ✓
- "Output capped at 1440p by height, aspect-preserving, no width cap (ultrawide safe)" → `fitOutputResolution` + tests (3440×1440 native, 4K→2560×1440, 5K2K→3412×1440). ✓
- "Even dimensions" → `even()` + odd-rounding test. ✓
- "fps fixed at 60" → default `fps: 60`. ✓
- "Source of truth = OBS not OS" → Task 1 reads from OBS only. ✓
- "Never throws / null on failure / OBS untouched" → try/catch + 0-dims and reject tests. ✓
- "Replace 3 hardcoded literals" → Task 2 Steps 3–5. ✓
- "Apply only at READY, never LIVE" → Task 2 wires only provision/repair/boot paths (none run during LIVE); noted in Global Constraints. ✓
- "Apply before startVirtualCam" → Task 2 Steps 3–5 order. ✓
- "CaptureMeta shape unchanged" → Task 2 uses existing `{sourceLabel,width,height,fps}`. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. ✓

**3. Type consistency:** `fitOutputResolution`/`OutputResolution`/`CaptureResolution`/`ResolutionDeps`/`applyCaptureResolution` names identical across Task 1 (definition), tests, and Task 2 (consumption). `CaptureMeta` matches `../shared/state.js`. The injected `call` signature `(req, params?) => Promise<T>` is consistent between the lib interface and the app's `sidecar.client().call` adapter. ✓

**Out of scope (deferred):** `StatChips` "1080p60" literal and the app window/UI responsiveness (piece B) are intentionally not in this plan.
