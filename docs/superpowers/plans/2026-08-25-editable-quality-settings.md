# Editable Quality Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user override output resolution, frame rate, video bitrate, and the hardware/software encoder choice, layered over the existing auto-detect, which stays the default.

**Architecture:** `choosePreset` gains one optional overrides argument for bitrate; resolution and FPS need no new capture-layer code at all, because `applyCaptureResolution` already accepts `maxHeight`/`fps` deps that no caller has ever supplied. Four nullable settings fields (`null` = Auto) flow through a new `quality.ts` resolver in main, a new `setQuality` IPC, and a `QualitySettings` component that replaces the existing read-only Quality section in Settings.

**Tech Stack:** TypeScript (ESM/NodeNext), Electron 31, React 18, vitest, obs-websocket via `@axistream/capture`.

**Spec:** `docs/superpowers/specs/2026-08-25-editable-quality-settings-design.md`

## Global Constraints

- Code style: 2-space indent, **no semicolons**, single quotes, named exports, `.js` extensions on all relative imports. No linter is configured — match surrounding code by hand.
- Every OBS call is best-effort: `console.warn`, never throw out. Nothing in this feature may block or throw out of the go-live path.
- Auto is the default for every field. A user who never opens the panel sees zero behavior change; defaults are `qualityHeight: null`, `qualityFps: null`, `qualityBitrateKbps: null`, `preferSoftwareAuto: false`.
- Allowed values: height ∈ {720, 1080, 1440}; fps ∈ {30, 60}; bitrate clamped to 1000–51000 kbps. Anything else loads as `null` (Auto).
- Audio bitrate stays fixed at 160 kbps. Out of scope: keyframe interval, encoder presets/tuning, per-encoder advanced options, separate recording quality.
- Test commands: `npm -w @axistream/capture run test`, `npm -w @axistream/app run test`. Typecheck gate: `cd packages/app && npx tsc --noEmit -p tsconfig.json`.
- Run the whole task list on a feature branch: `git checkout -b feat/quality-settings` before Task 1.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/capture/src/encoder-presets.ts` | Add `QualityOverrides`; `choosePreset` honors a bitrate override |
| `packages/capture/test/encoder-presets.test.ts` | Override behavior next to the auto table it modifies |
| `packages/capture/test/capture-resolution.test.ts` | First coverage of the `maxHeight`/`fps` deps |
| `packages/app/src/shared/state.ts` (Task 2 part) | `QUALITY_HEIGHTS`/`QUALITY_FPS`/bitrate bounds — shared, because the renderer must not import main-process code |
| `packages/app/src/main/StreamSettings.ts` | Four new persisted fields + their load-time validation |
| `packages/app/test/stream-settings.test.ts` | Round-trip, rejection, clamping, pre-feature file |
| `packages/app/src/shared/state.ts` | `QualityView`, `QualityPatch`, `DEFAULT_QUALITY`, `AppState.quality`, `CH.setQuality`, `AxiApi.setQuality` |
| `packages/app/src/preload/index.ts` | Bridge `setQuality` |
| `packages/app/src/main/ipc.ts` | `IpcHandlers.setQuality` + channel registration |
| `packages/app/test/ipc-contract.test.ts` | Assert the new channel is registered |
| `packages/app/src/main/quality.ts` | **New.** Pure resolvers: settings → apply args, settings → renderer view |
| `packages/app/test/quality.test.ts` | **New.** Resolver unit tests |
| `packages/app/src/main/index.ts` | Wire resolvers into apply paths, `setQuality` handler, go-live re-apply, encoder-kind refresh, boot seeding |
| `packages/app/src/renderer/components/QualitySettings.tsx` | **New.** Collapsible panel with four controls |
| `packages/app/test/quality-settings.test.tsx` | **New.** Component behavior |
| `packages/app/src/renderer/components/SettingsScreen.tsx` | Swap the read-only Quality section for the component |
| `packages/app/src/renderer/styles.css` | Styles for the summary header and number input |

---

### Task 1: Bitrate override in the capture package

**Files:**
- Modify: `packages/capture/src/encoder-presets.ts`
- Test: `packages/capture/test/encoder-presets.test.ts`, `packages/capture/test/capture-resolution.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export interface QualityOverrides { videoBitrateKbps?: number | null }` and `choosePreset(kind: EncoderKind, outputHeight: number, fps: number, overrides?: QualityOverrides): EncoderPreset`. Both are re-exported from `@axistream/capture` automatically — `packages/capture/src/index.ts` already has `export * from './encoder-presets.js'`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/capture/test/encoder-presets.test.ts`, inside the existing `describe('choosePreset', ...)` block:

```ts
  it('uses an explicit bitrate override instead of the height/fps table', () => {
    expect(choosePreset('nvenc', 1080, 60, { videoBitrateKbps: 4500 }).videoBitrateKbps).toBe(4500)
    expect(choosePreset('x264', 720, 30, { videoBitrateKbps: 20000 }).videoBitrateKbps).toBe(20000)
  })

  it('falls back to the table when the override is null, undefined, or absent', () => {
    expect(choosePreset('x264', 1080, 60, { videoBitrateKbps: null }).videoBitrateKbps).toBe(9000)
    expect(choosePreset('x264', 1080, 60, { videoBitrateKbps: undefined }).videoBitrateKbps).toBe(9000)
    expect(choosePreset('x264', 1080, 60, {}).videoBitrateKbps).toBe(9000)
    expect(choosePreset('x264', 1080, 60).videoBitrateKbps).toBe(9000)
  })

  it('leaves encoder identity and audio bitrate untouched by an override', () => {
    const p = choosePreset('vaapi', 1440, 60, { videoBitrateKbps: 3000 })
    expect(p).toMatchObject({ streamEncoder: 'ffmpeg_vaapi', label: 'VAAPI', audioBitrateKbps: 160 })
  })
```

Append to `packages/capture/test/capture-resolution.test.ts` a new top-level block (place it after the existing `describe` blocks):

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm -w @axistream/capture run test -- encoder-presets capture-resolution
```

Expected: the three `encoder-presets` cases FAIL (`choosePreset` ignores the 4th argument, so the table value comes back). The `capture-resolution` block may already PASS — those deps exist but were never exercised; that is the point of adding them, and a green result there is fine.

- [ ] **Step 3: Implement the override**

In `packages/capture/src/encoder-presets.ts`, add the type after the `EncoderPreset` interface:

```ts
/** User overrides layered over the auto-detected preset. `null`/absent = auto. */
export interface QualityOverrides {
  videoBitrateKbps?: number | null
}
```

and replace `choosePreset` with:

```ts
export function choosePreset(
  kind: EncoderKind, outputHeight: number, fps: number, overrides?: QualityOverrides,
): EncoderPreset {
  const e = ENCODERS[kind]
  return {
    ...e,
    videoBitrateKbps: overrides?.videoBitrateKbps ?? videoBitrate(outputHeight, fps),
    audioBitrateKbps: 160,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm -w @axistream/capture run test
```

Expected: PASS, whole capture suite green.

- [ ] **Step 5: Commit**

```bash
git add packages/capture/src/encoder-presets.ts packages/capture/test/encoder-presets.test.ts packages/capture/test/capture-resolution.test.ts
git commit -m "feat(capture): let choosePreset take an explicit bitrate override"
```

---

### Task 2: Persist the quality fields

**Files:**
- Modify: `packages/app/src/shared/state.ts`
- Modify: `packages/app/src/main/StreamSettings.ts`
- Test: `packages/app/test/stream-settings.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: four fields on `StreamSettingsData` — `qualityHeight: number | null`, `qualityFps: number | null`, `qualityBitrateKbps: number | null`, `preferSoftwareAuto: boolean` — plus four constants exported from **`packages/app/src/shared/state.ts`**: `QUALITY_HEIGHTS: number[]`, `QUALITY_FPS: number[]`, `MIN_BITRATE_KBPS: number`, `MAX_BITRATE_KBPS: number`. Task 4 reads the fields; Task 5 imports the constants for its option lists.

The constants go in `shared/state.ts` rather than beside the settings they validate because the renderer needs them and **no renderer file imports from `src/main/` anywhere in this codebase** — `StreamSettings.ts` imports `node:fs` at module scope, so pulling it into the renderer bundle would be a real break, not a style preference.

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/test/stream-settings.test.ts`. That file already has a `beforeEach` assigning a fresh temp path to `file`, and a `tmpFile()` helper for a second independent path — use `new StreamSettings(file)` and `writeFileSync`, both already imported there.

```ts
describe('StreamSettings quality fields', () => {
  it('defaults every quality field to auto', () => {
    const d = new StreamSettings(file).load()

    expect(d.qualityHeight).toBeNull()
    expect(d.qualityFps).toBeNull()
    expect(d.qualityBitrateKbps).toBeNull()
    expect(d.preferSoftwareAuto).toBe(false)
  })

  it('round-trips valid quality values', () => {
    new StreamSettings(file).patch({ qualityHeight: 720, qualityFps: 30, qualityBitrateKbps: 4500, preferSoftwareAuto: true })

    const d = new StreamSettings(file).load()
    expect(d.qualityHeight).toBe(720)
    expect(d.qualityFps).toBe(30)
    expect(d.qualityBitrateKbps).toBe(4500)
    expect(d.preferSoftwareAuto).toBe(true)
  })

  it('reverts an off-list height or fps to auto rather than encoding something impossible', () => {
    new StreamSettings(file).patch({ qualityHeight: 999, qualityFps: 144 })

    const d = new StreamSettings(file).load()
    expect(d.qualityHeight).toBeNull()
    expect(d.qualityFps).toBeNull()
  })

  it('clamps bitrate into the ingest range instead of dropping it', () => {
    const s = new StreamSettings(file)

    s.patch({ qualityBitrateKbps: 60000 })
    expect(s.load().qualityBitrateKbps).toBe(51000)

    s.patch({ qualityBitrateKbps: 10 })
    expect(s.load().qualityBitrateKbps).toBe(1000)
  })

  it('treats a non-numeric bitrate as auto', () => {
    const s = new StreamSettings(file)

    s.patch({ qualityBitrateKbps: 'fast' as unknown as number })

    expect(s.load().qualityBitrateKbps).toBeNull()
  })

  it('loads a settings file written before this feature as fully auto', () => {
    const older = tmpFile()
    writeFileSync(older, JSON.stringify({ titleTemplate: 'x', gameAudioApps: [], preferSoftware: true }))

    const d = new StreamSettings(older).load()
    expect(d.qualityHeight).toBeNull()
    expect(d.qualityFps).toBeNull()
    expect(d.qualityBitrateKbps).toBeNull()
    expect(d.preferSoftware).toBe(true)
    expect(d.preferSoftwareAuto).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm -w @axistream/app run test -- stream-settings
```

Expected: FAIL — the fields do not exist on `StreamSettingsData` (TypeScript errors) and `load()` returns no such keys.

- [ ] **Step 3: Add the fields, defaults, and validation**

In `packages/app/src/main/StreamSettings.ts`, add to the `StreamSettingsData` interface, after `webcam: WebcamConfig`:

```ts
  /** null = Auto. Auto tracks the monitor (capped at 1440) and 60fps, and
   *  derives bitrate from those two — see choosePreset in @axistream/capture. */
  qualityHeight: number | null
  qualityFps: number | null
  qualityBitrateKbps: number | null
  /** True when the failed-go-live retry set preferSoftware, not the user.
   *  Affects the settings panel's help text only, never behavior. */
  preferSoftwareAuto: boolean
```

Add to `DEFAULT_SETTINGS`, after `webcam: { ...DEFAULT_WEBCAM }`:

```ts
  qualityHeight: null,
  qualityFps: null,
  qualityBitrateKbps: null,
  preferSoftwareAuto: false,
```

Add the constants to `packages/app/src/shared/state.ts`, near the existing `WEBCAM_MIN_SIZE_PCT`/`WEBCAM_MAX_SIZE_PCT` constants:

```ts
export const QUALITY_HEIGHTS = [720, 1080, 1440]
export const QUALITY_FPS = [30, 60]
export const MIN_BITRATE_KBPS = 1000
export const MAX_BITRATE_KBPS = 51000
```

Then add the guards to `packages/app/src/main/StreamSettings.ts`, next to the existing `PRIVACIES`/`MASK_STYLES`/`clamp` block, importing the constants by extending the file's existing `'../shared/state.js'` import with `QUALITY_HEIGHTS, QUALITY_FPS, MIN_BITRATE_KBPS, MAX_BITRATE_KBPS`:

```ts
/** An off-list value means a hand-edited or corrupt file — degrade to Auto
 *  rather than asking an encoder for a resolution nothing can produce. */
const oneOf = (raw: unknown, allowed: number[]): number | null =>
  typeof raw === 'number' && allowed.includes(raw) ? raw : null

/** Bitrate is a continuous range, so a plausible out-of-range number is a
 *  typo worth clamping rather than discarding. */
const bitrateOf = (raw: unknown): number | null =>
  typeof raw === 'number' && Number.isFinite(raw)
    ? Math.round(clamp(raw, MIN_BITRATE_KBPS, MAX_BITRATE_KBPS))
    : null
```

Add to the object returned by `load()`, after `webcam: sanitizeWebcam(raw.webcam),`:

```ts
        qualityHeight: oneOf(raw.qualityHeight, QUALITY_HEIGHTS),
        qualityFps: oneOf(raw.qualityFps, QUALITY_FPS),
        qualityBitrateKbps: bitrateOf(raw.qualityBitrateKbps),
        preferSoftwareAuto: typeof raw.preferSoftwareAuto === 'boolean' ? raw.preferSoftwareAuto : DEFAULT_SETTINGS.preferSoftwareAuto,
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm -w @axistream/app run test -- stream-settings
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/StreamSettings.ts packages/app/test/stream-settings.test.ts
git commit -m "feat(settings): persist quality overrides, defaulting to auto"
```

---

### Task 3: Shared state, IPC channel, and preload bridge

**Files:**
- Modify: `packages/app/src/shared/state.ts`
- Modify: `packages/app/src/preload/index.ts:63` (beside the existing `setWebcam` bridge)
- Modify: `packages/app/src/main/ipc.ts`
- Modify: `packages/app/test/ipc-contract.test.ts`
- Modify: `packages/app/test/settings-screen.test.tsx:34`, `packages/app/test/stream-screen.test.tsx:8` (AppState fixtures)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface QualityView { height: number | null; fps: number | null; bitrateKbps: number | null; preferSoftware: boolean; preferSoftwareAuto: boolean }`
  - `export interface QualityPatch { height?: number | null; fps?: number | null; bitrateKbps?: number | null; preferSoftware?: boolean }`
  - `export const DEFAULT_QUALITY: QualityView`
  - `AppState.quality: QualityView`
  - `CH.setQuality = 'axi:setQuality'`
  - `AxiApi.setQuality(p: QualityPatch): Promise<void>` and the matching `IpcHandlers.setQuality`

  Task 4 implements the handler; Task 5 calls `axi.setQuality`.

- [ ] **Step 1: Write the failing test**

In `packages/app/test/ipc-contract.test.ts`, add `CH.setQuality` to the `commandChannels` array — put it on the line with the webcam channels:

```ts
      CH.setWebcam, CH.getWebcamDevices, CH.getWebcamProps,
      CH.setQuality,
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm -w @axistream/app run test -- ipc-contract
```

Expected: FAIL — `CH.setQuality` does not exist (TypeScript error), and no handler is registered for it.

- [ ] **Step 3: Add the types, channel, and bridge**

In `packages/app/src/shared/state.ts`, add near the other view types (above `AppState`):

```ts
export interface QualityView {
  height: number | null
  fps: number | null
  bitrateKbps: number | null
  preferSoftware: boolean
  preferSoftwareAuto: boolean
}

/** A partial edit from the renderer. Keys map to the `quality*` settings
 *  fields; `null` means "back to Auto". */
export interface QualityPatch {
  height?: number | null
  fps?: number | null
  bitrateKbps?: number | null
  preferSoftware?: boolean
}

export const DEFAULT_QUALITY: QualityView = {
  height: null, fps: null, bitrateKbps: null, preferSoftware: false, preferSoftwareAuto: false,
}
```

Add to `AppState`, after `webcam: WebcamView`:

```ts
  quality: QualityView
```

Add to `INITIAL_STATE`, after the `webcam:` line:

```ts
  quality: { ...DEFAULT_QUALITY },
```

Add to `CH`, after `getWebcamProps: 'axi:getWebcamProps',`:

```ts
  setQuality: 'axi:setQuality',
```

Add to `AxiApi`, after `getWebcamProps(): Promise<WebcamProps>`:

```ts
  setQuality(p: QualityPatch): Promise<void>
```

In `packages/app/src/preload/index.ts`, after the `setWebcam` line:

```ts
  setQuality: (p) => ipcRenderer.invoke(CH.setQuality, p) as Promise<void>,
```

In `packages/app/src/main/ipc.ts`: add `type QualityPatch` to the existing import from `'../shared/state.js'`; add to `IpcHandlers` after `getWebcamProps(): Promise<WebcamProps>`:

```ts
  setQuality(p: QualityPatch): Promise<void>
```

and add the registration after the `CH.getWebcamProps` line in `registerIpc`:

```ts
  ipcMain.handle(CH.setQuality, (_e: unknown, p: QualityPatch) => handlers.setQuality(p))
```

- [ ] **Step 4: Fix the two full-AppState test fixtures**

Adding a required field to `AppState` breaks every literal that spells the whole state out. Two files do:

In `packages/app/test/stream-screen.test.tsx:8`, add `quality: { ...DEFAULT_QUALITY },` to the `base` object (before `recording:`), and add `DEFAULT_QUALITY` to the existing `import { DEFAULT_WEBCAM } from '../src/shared/state.js'` line.

In `packages/app/test/settings-screen.test.tsx:34`, add the same field to its `base` object and import `DEFAULT_QUALITY` alongside its existing imports. Also add `setQuality: vi.fn(async () => {}),` to that file's `axi` mock object.

`packages/app/test/sidebar.test.tsx` spreads `INITIAL_STATE` and needs no change.

- [ ] **Step 5: Run the tests and the typecheck**

```bash
npm -w @axistream/app run test -- ipc-contract stream-screen settings-screen
cd packages/app && npx tsc --noEmit -p tsconfig.json; cd -
```

Expected: tests PASS. The typecheck FAILS with exactly one error — `index.ts` does not implement `IpcHandlers.setQuality`. That is Task 4's job; do not stub it here.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/preload/index.ts packages/app/src/main/ipc.ts packages/app/test/ipc-contract.test.ts packages/app/test/stream-screen.test.tsx packages/app/test/settings-screen.test.tsx
git commit -m "feat(ipc): add the setQuality channel and quality state slice"
```

---

### Task 4: Main-process resolvers and wiring

**Files:**
- Create: `packages/app/src/main/quality.ts`
- Create: `packages/app/test/quality.test.ts`
- Modify: `packages/app/src/main/index.ts` (encoder block ~line 446, `applyResolution` ~line 527, `goLive` ~line 550, `onPhase` ~line 475, handlers ~line 1043, boot seeding ~line 1197)

**Interfaces:**
- Consumes: `StreamSettingsData` with `qualityHeight`/`qualityFps`/`qualityBitrateKbps`/`preferSoftwareAuto` (Task 2); `QualityView`/`QualityPatch`/`IpcHandlers.setQuality` (Task 3); `choosePreset(kind, h, fps, overrides?)` and `QualityOverrides` (Task 1).
- Produces: `qualityOf(s: StreamSettingsData): { maxHeight: number; fps: number; overrides: QualityOverrides }` and `qualityViewOf(s: StreamSettingsData): QualityView`, both from `packages/app/src/main/quality.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/quality.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { qualityOf, qualityViewOf } from '../src/main/quality.js'
import { DEFAULT_SETTINGS } from '../src/main/StreamSettings.js'

const s = (over: Partial<typeof DEFAULT_SETTINGS> = {}) => ({ ...DEFAULT_SETTINGS, ...over })

describe('qualityOf', () => {
  it('resolves auto to the shipped defaults: a 1440 cap at 60fps, bitrate from the table', () => {
    expect(qualityOf(s())).toEqual({ maxHeight: 1440, fps: 60, overrides: { videoBitrateKbps: null } })
  })

  it('passes each override through when the user set one', () => {
    expect(qualityOf(s({ qualityHeight: 720, qualityFps: 30, qualityBitrateKbps: 4500 })))
      .toEqual({ maxHeight: 720, fps: 30, overrides: { videoBitrateKbps: 4500 } })
  })

  it('resolves each field independently — a custom fps leaves resolution on auto', () => {
    expect(qualityOf(s({ qualityFps: 30 }))).toEqual({ maxHeight: 1440, fps: 30, overrides: { videoBitrateKbps: null } })
  })
})

describe('qualityViewOf', () => {
  it('maps settings fields to the renderer vocabulary', () => {
    expect(qualityViewOf(s({ qualityHeight: 1080, qualityFps: null, qualityBitrateKbps: 9000, preferSoftware: true, preferSoftwareAuto: true })))
      .toEqual({ height: 1080, fps: null, bitrateKbps: 9000, preferSoftware: true, preferSoftwareAuto: true })
  })

  it('reports a stock install as fully auto', () => {
    expect(qualityViewOf(s())).toEqual({ height: null, fps: null, bitrateKbps: null, preferSoftware: false, preferSoftwareAuto: false })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm -w @axistream/app run test -- quality.test
```

Expected: FAIL — `src/main/quality.ts` does not exist.

- [ ] **Step 3: Create the resolver module**

Create `packages/app/src/main/quality.ts`:

```ts
import type { QualityOverrides } from '@axistream/capture'
import type { QualityView } from '../shared/state.js'
import type { StreamSettingsData } from './StreamSettings.js'

/** Auto's resolved values. The cap matches applyCaptureResolution's own
 *  default, so "Auto" and "no override" are the same stream. */
const AUTO_MAX_HEIGHT = 1440
const AUTO_FPS = 60

export interface QualityApplyArgs {
  maxHeight: number
  fps: number
  overrides: QualityOverrides
}

/** Settings -> the arguments applyCaptureResolution and choosePreset need. */
export function qualityOf(s: StreamSettingsData): QualityApplyArgs {
  return {
    maxHeight: s.qualityHeight ?? AUTO_MAX_HEIGHT,
    fps: s.qualityFps ?? AUTO_FPS,
    overrides: { videoBitrateKbps: s.qualityBitrateKbps },
  }
}

/** Settings -> the slice the renderer's Quality panel reads. */
export function qualityViewOf(s: StreamSettingsData): QualityView {
  return {
    height: s.qualityHeight,
    fps: s.qualityFps,
    bitrateKbps: s.qualityBitrateKbps,
    preferSoftware: s.preferSoftware,
    preferSoftwareAuto: s.preferSoftwareAuto,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm -w @axistream/app run test -- quality.test
```

Expected: PASS.

- [ ] **Step 5: Wire the resolvers into the apply paths**

In `packages/app/src/main/index.ts`:

Add to the imports: `import { qualityOf, qualityViewOf } from './quality.js'`, and add `type QualityPatch` and `type QualityView` to the existing `../shared/state.js` import.

Replace the encoder-kind initialization (~line 446) so the kind can be recomputed when the user toggles software encoding:

```ts
  const detectKind = (): EncoderKind => settings.load().preferSoftware
    ? 'x264'
    : detectEncoder({ platform: process.platform, existsSync, readdirSync })
  let encoderKind: EncoderKind = detectKind()
```

Change `applyEncoderPreset` (~line 450) to consult the user's override:

```ts
  const applyEncoderPreset = async (outputHeight: number, fps: number, opts?: { tries?: number }): Promise<boolean> => {
    currentPreset = choosePreset(encoderKind, outputHeight, fps, qualityOf(settings.load()).overrides)
    setState({ encoder: currentPreset.label, videoBitrateKbps: currentPreset.videoBitrateKbps })
    return applyEncoderSettings({ call: (r, p) => sidecar.client().call(r as never, p as never), tries: opts?.tries }, currentPreset)
  }
```

Change `applyResolution` (~line 527) to supply the deps `applyCaptureResolution` has always accepted:

```ts
  const applyResolution = async (): Promise<CaptureMeta> => {
    const q = qualityOf(settings.load())
    await applyCaptureResolution({
      call: (r, p) => sidecar.client().call(r as never, p as never),
      maxHeight: q.maxHeight,
      fps: q.fps,
    })
```

(leave the rest of that function — the `GetVideoSettings` read-back and the catch fallback — exactly as it is; it stays the authority on what OBS actually holds.)

In `onPhase` (~line 475), record that the app, not the user, chose software:

```ts
      if (p === 'LIVE' && pendingSoftwareFlip) {
        pendingSoftwareFlip = false
        const next = settings.patch({ preferSoftware: true, preferSoftwareAuto: true })
        setState({ quality: qualityViewOf(next) })
      } else if ((p === 'ERROR' || p === 'READY') && pendingSoftwareFlip) {
```

- [ ] **Step 6: Add the setQuality handler and the go-live re-apply**

In the handlers object (~line 1043, right after `getWebcamProps`), add:

```ts
    setQuality: async (p: QualityPatch) => {
      const patch: Partial<StreamSettingsData> = {}
      if ('height' in p) patch.qualityHeight = p.height ?? null
      if ('fps' in p) patch.qualityFps = p.fps ?? null
      if ('bitrateKbps' in p) patch.qualityBitrateKbps = p.bitrateKbps ?? null
      // A user touching the checkbox takes ownership of the choice, so the
      // "AxiStream switched this for you" explanation stops applying.
      if ('preferSoftware' in p) { patch.preferSoftware = p.preferSoftware === true; patch.preferSoftwareAuto = false }
      settings.patch(patch)
      // Read back rather than trusting the patch: load() is where clamping
      // and off-list rejection happen, so this is the value that will be used.
      const next = settings.load()
      setState({ quality: qualityViewOf(next) })
      if ('preferSoftware' in p) encoderKind = detectKind()
      // Applying now keeps the preview and the stat chips truthful. Safe
      // because only the output scale moves — base stays the monitor's native
      // size, so masks and the webcam do not shift. Deferred while live.
      const live = state.phase === 'LIVE' || state.phase === 'RECONNECTING'
      if (!live && state.capture) {
        const capture_ = await applyResolution()
        await applyEncoderPreset(capture_.outputHeight, capture_.fps)
        setState({ capture: capture_ })
      }
    },
```

`StreamSettingsData` must be in scope — add `type StreamSettingsData` to the existing `./StreamSettings.js` import if it is not already there.

In `goLive` (~line 550), immediately after `setState({ phase: 'GOING_LIVE' })`, add:

```ts
        // Bitrate and encoder are profile parameters OBS only reads at
        // StartStream, so a quality edit lands here. Unconditional rather
        // than flag-guarded: it is idempotent, best-effort, and cannot
        // desync the way a pending-change flag can.
        if (state.capture) {
          const capture_ = await applyResolution()
          await applyEncoderPreset(capture_.outputHeight, capture_.fps)
          setState({ capture: capture_ })
        }
```

- [ ] **Step 7: Seed the slice at boot**

At the boot state push (~line 1197), extend the existing `setState`:

```ts
      setState({ masks: a.masks, masksVisible: a.masksVisible, webcam: { ...a.webcam, available: true }, quality: qualityViewOf(a) })
```

- [ ] **Step 8: Run the typecheck and the full suite**

```bash
cd packages/app && npx tsc --noEmit -p tsconfig.json; cd -
npm -w @axistream/app run test
```

Expected: typecheck clean (the Task 3 error is now resolved), all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/app/src/main/quality.ts packages/app/test/quality.test.ts packages/app/src/main/index.ts
git commit -m "feat(main): apply quality overrides and re-apply them at go-live"
```

---

### Task 5: The Quality settings panel

**Files:**
- Create: `packages/app/src/renderer/components/QualitySettings.tsx`
- Create: `packages/app/test/quality-settings.test.tsx`
- Modify: `packages/app/src/renderer/components/SettingsScreen.tsx:28-34` (replace the read-only Quality section)
- Modify: `packages/app/src/renderer/styles.css`

**Interfaces:**
- Consumes: `AppState.quality` / `QualityView` / `AxiApi.setQuality` (Task 3); `QUALITY_HEIGHTS`, `QUALITY_FPS`, `MIN_BITRATE_KBPS`, `MAX_BITRATE_KBPS` from `../../shared/state.js` (Task 2).
- Produces: `export function QualitySettings({ state, axi }: { state: AppState; axi: AxiApi })`.

- [ ] **Step 1: Write the failing tests**

Create `packages/app/test/quality-settings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QualitySettings } from '../src/renderer/components/QualitySettings.js'
import { INITIAL_STATE, DEFAULT_QUALITY, type AppState } from '../src/shared/state.js'

const axi = { setQuality: vi.fn(async () => {}) }

const mk = (over: Partial<AppState> = {}): AppState => ({
  ...INITIAL_STATE,
  phase: 'READY',
  encoder: 'NVENC',
  videoBitrateKbps: 9000,
  capture: { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, outputWidth: 1920, outputHeight: 1080, fps: 60 },
  quality: { ...DEFAULT_QUALITY },
  ...over,
})

const expand = async () => { await userEvent.click(screen.getByRole('button', { name: /quality/i })) }

describe('QualitySettings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('summarises what the stream is actually getting, without expanding', () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)

    const header = screen.getByRole('button', { name: /quality/i })
    expect(header).toHaveTextContent('Auto')
    expect(header).toHaveTextContent('1080p60')
    expect(header).toHaveTextContent('9000 kbps')
    expect(header).toHaveTextContent('NVENC')
    expect(screen.queryByLabelText(/resolution/i)).toBeNull()
  })

  it('says Custom once any field is overridden', () => {
    render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, fps: 30 } })} axi={axi as never} />)

    expect(screen.getByRole('button', { name: /quality/i })).toHaveTextContent('Custom')
  })

  it('omits resolutions the monitor cannot produce', async () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)
    await expand()

    const opts = Array.from(screen.getByLabelText(/resolution/i).querySelectorAll('option')).map((o) => o.textContent)
    expect(opts).toContain('720p')
    expect(opts).toContain('1080p')
    expect(opts.some((o) => o?.includes('1440'))).toBe(false)
  })

  it('labels Auto with the value it resolves to from the monitor, not the active override', async () => {
    render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, height: 720 }, capture: { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, outputWidth: 1280, outputHeight: 720, fps: 60 } })} axi={axi as never} />)
    await expand()

    const opts = Array.from(screen.getByLabelText(/resolution/i).querySelectorAll('option')).map((o) => o.textContent)
    expect(opts).toContain('Auto (1080p)')
  })

  it('sends the picked resolution', async () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)
    await expand()

    fireEvent.change(screen.getByLabelText(/resolution/i), { target: { value: '720' } })

    expect(axi.setQuality).toHaveBeenCalledWith({ height: 720 })
  })

  it('sends null when resolution goes back to Auto', async () => {
    render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, height: 720 } })} axi={axi as never} />)
    await expand()

    fireEvent.change(screen.getByLabelText(/resolution/i), { target: { value: 'auto' } })

    expect(axi.setQuality).toHaveBeenCalledWith({ height: null })
  })

  it('sends the picked frame rate', async () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)
    await expand()

    fireEvent.change(screen.getByLabelText(/frame rate/i), { target: { value: '30' } })

    expect(axi.setQuality).toHaveBeenCalledWith({ fps: 30 })
  })

  it('seeds the manual bitrate from what auto had chosen, so the box is never empty', async () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)
    await expand()

    await userEvent.click(screen.getByRole('checkbox', { name: /set the bitrate manually/i }))

    expect(axi.setQuality).toHaveBeenCalledWith({ bitrateKbps: 9000 })
  })

  it('hides the bitrate box until manual is ticked, and returns to auto when unticked', async () => {
    const { rerender } = render(<QualitySettings state={mk()} axi={axi as never} />)
    await expand()
    expect(screen.queryByLabelText(/bitrate \(kbps\)/i)).toBeNull()

    rerender(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, bitrateKbps: 4500 } })} axi={axi as never} />)
    expect(screen.getByLabelText(/bitrate \(kbps\)/i)).toHaveValue(4500)

    await userEvent.click(screen.getByRole('checkbox', { name: /set the bitrate manually/i }))
    expect(axi.setQuality).toHaveBeenCalledWith({ bitrateKbps: null })
  })

  it('toggles software encoding', async () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)
    await expand()

    await userEvent.click(screen.getByRole('checkbox', { name: /software encoding/i }))

    expect(axi.setQuality).toHaveBeenCalledWith({ preferSoftware: true })
  })

  it('explains a software fallback the app chose, not the user', async () => {
    render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, preferSoftware: true, preferSoftwareAuto: true } })} axi={axi as never} />)
    await expand()

    expect(screen.getByText(/switched to software encoding after a stream failed/i)).toBeInTheDocument()
  })

  it('gives the generic explanation when the user ticked it themselves', async () => {
    render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, preferSoftware: true, preferSoftwareAuto: false } })} axi={axi as never} />)
    await expand()

    expect(screen.queryByText(/switched to software encoding after a stream failed/i)).toBeNull()
    expect(screen.getByText(/use the cpu instead of your graphics card/i)).toBeInTheDocument()
  })

  it('stays editable while live, but says the change is deferred', () => {
    render(<QualitySettings state={mk({ phase: 'LIVE' })} axi={axi as never} />)

    expect(screen.getByText(/applies to your next stream/i)).toBeInTheDocument()
  })

  it('says nothing about deferral when not live', () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)

    expect(screen.queryByText(/applies to your next stream/i)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm -w @axistream/app run test -- quality-settings
```

Expected: FAIL — the component module does not exist.

- [ ] **Step 3: Write the component**

Create `packages/app/src/renderer/components/QualitySettings.tsx`:

```tsx
import { useState } from 'react'
import type { AppState, AxiApi } from '../../shared/state.js'
import { QUALITY_HEIGHTS, QUALITY_FPS, MIN_BITRATE_KBPS, MAX_BITRATE_KBPS } from '../../shared/state.js'

/** Auto's resolved cap, mirroring qualityOf in the main process. Used only to
 *  label the Auto option truthfully. */
const AUTO_MAX_HEIGHT = 1440
const AUTO_FPS = 60

export function QualitySettings({ state, axi }: { state: AppState; axi: AxiApi }) {
  const [open, setOpen] = useState(false)
  const q = state.quality
  const { capture } = state
  const live = state.phase === 'LIVE' || state.phase === 'RECONNECTING'

  const isCustom = q.height !== null || q.fps !== null || q.bitrateKbps !== null || q.preferSoftware
  const resolved = capture ? `${capture.outputHeight}p${capture.fps}` : '—'
  const bitrate = state.videoBitrateKbps ? `${state.videoBitrateKbps} kbps` : '—'
  const summary = `${isCustom ? 'Custom' : 'Auto'} · ${resolved} · ${bitrate} · ${state.encoder}`

  // Auto resolves from the monitor's NATIVE height, not the current output —
  // otherwise a custom 720p would make the Auto option label itself "720p".
  const autoHeight = capture ? Math.min(capture.height, AUTO_MAX_HEIGHT) : AUTO_MAX_HEIGHT
  const heights = QUALITY_HEIGHTS.filter((h) => !capture || h <= capture.height)

  const manualBitrate = q.bitrateKbps !== null

  return (
    <div className="quality-settings">
      <button className="quality-header" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <h3>Quality</h3>
        <span className="muted">{summary}</span>
      </button>
      {live ? <p className="muted">Applies to your next stream.</p> : null}

      {open ? (
        <div className="quality-body">
          <label>
            <span>Resolution</span>
            <select
              value={q.height === null ? 'auto' : String(q.height)}
              onChange={(e) => void axi.setQuality({ height: e.target.value === 'auto' ? null : Number(e.target.value) })}
            >
              <option value="auto">{`Auto (${autoHeight}p)`}</option>
              {heights.map((h) => <option key={h} value={h}>{`${h}p`}</option>)}
            </select>
          </label>

          <label>
            <span>Frame rate</span>
            <select
              value={q.fps === null ? 'auto' : String(q.fps)}
              onChange={(e) => void axi.setQuality({ fps: e.target.value === 'auto' ? null : Number(e.target.value) })}
            >
              <option value="auto">{`Auto (${AUTO_FPS})`}</option>
              {QUALITY_FPS.map((f) => <option key={f} value={f}>{String(f)}</option>)}
            </select>
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={manualBitrate}
              /* Seed from what auto had chosen so the box is never empty and
                 the first edit is a nudge, not a from-scratch guess. */
              onChange={(e) => void axi.setQuality({ bitrateKbps: e.target.checked ? (state.videoBitrateKbps ?? 6000) : null })}
            />
            Set the bitrate manually
          </label>

          {manualBitrate ? (
            <label>
              <span>Bitrate (kbps)</span>
              <input
                type="number"
                min={MIN_BITRATE_KBPS}
                max={MAX_BITRATE_KBPS}
                step={500}
                value={q.bitrateKbps ?? 0}
                onChange={(e) => void axi.setQuality({ bitrateKbps: Number(e.target.value) })}
              />
            </label>
          ) : null}

          <label className="check">
            <input
              type="checkbox"
              checked={q.preferSoftware}
              onChange={(e) => void axi.setQuality({ preferSoftware: e.target.checked })}
            />
            Software encoding
          </label>
          <p className="muted">
            {q.preferSoftware && q.preferSoftwareAuto
              ? 'AxiStream switched to software encoding after a stream failed to start — untick to try your graphics card again.'
              : 'Use the CPU instead of your graphics card. Slower, but works everywhere.'}
          </p>
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Mount it and drop the read-only section**

In `packages/app/src/renderer/components/SettingsScreen.tsx`, add `import { QualitySettings } from './QualitySettings.js'` beside the other component imports, and replace the whole read-only Quality section:

```tsx
          <section className="setting">
            <h3>Quality</h3>
            <p className="muted">
              {state.encoder}
              {state.videoBitrateKbps ? ` · ${state.videoBitrateKbps / 1000} Mbps` : ''}
              {state.capture ? ` — chosen automatically for ${state.capture.outputHeight}p${state.capture.fps}` : ' — chosen automatically'}
            </p>
          </section>
```

with:

```tsx
          <section className="setting">
            <QualitySettings state={state} axi={axi} />
          </section>
```

Add the styles to `packages/app/src/renderer/styles.css`:

```css
.quality-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  padding: 0;
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.quality-header h3 { margin: 0; }
.quality-body { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
.quality-body input[type='number'] { width: 8ch; }
```

- [ ] **Step 5: Run the tests, the typecheck, and a renderer build**

```bash
npm -w @axistream/app run test
cd packages/app && npx tsc --noEmit -p tsconfig.json && npm run build; cd -
```

Expected: all tests PASS, typecheck clean, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/components/QualitySettings.tsx packages/app/test/quality-settings.test.tsx packages/app/src/renderer/components/SettingsScreen.tsx packages/app/src/renderer/styles.css
git commit -m "feat(ui): make the Quality settings section editable"
```

---

## Final Verification

- [ ] **Both suites and the typecheck**

```bash
npm -w @axistream/capture run test
npm -w @axistream/app run test
cd packages/app && npx tsc --noEmit -p tsconfig.json; cd -
```

- [ ] **Manual smoke** (needs a real GPU, a monitor, and a YouTube account — record the results, do not skip silently)

1. Open Settings with a stock config: the Quality header reads `Auto · <your monitor>p60 · <n> kbps · NVENC` (or VAAPI/x264).
2. Expand, set Resolution 720p and Frame rate 30. Not live, so the change applies at once: the capture pill and the stat chips both switch to 720p30, and the bitrate drops to 4000 (720p under 50fps).
3. Go live, confirm the YouTube VOD reports 720p30.
4. Back to Auto on both, tick "Set the bitrate manually", set 3000. Go live and confirm the stat chip reads ~3000 kbps.
5. Tick Software encoding: the chip reads x264 at the next go-live.
6. While live, change Resolution: the panel says "Applies to your next stream" and the live stream does not change resolution mid-broadcast.
7. Untick everything; the header returns to `Auto` and the stream matches step 1.
