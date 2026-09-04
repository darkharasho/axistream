# Encoder Codec Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick a specific encoder (vendor + codec) instead of AxiStream auto-picking one, and stop the VAAPI preset from silently running software x264 under a "VAAPI" label.

**Architecture:** `@axistream/capture` owns a single table of encoder entries (id, label, OBS `SimpleOutput/StreamEncoder` string, vendor, codec gating) plus two pure functions — `encoderAvailability()` and `resolveEncoder()` — so the whole enable/disable matrix is unit-testable with no OBS running. The app persists an `EncoderId` in settings, migrating the old `preferSoftware` boolean, and `QualitySettings.tsx` renders every row from the OBS dropdown with unavailable ones disabled and labelled with the reason.

**Tech Stack:** TypeScript (ESM/NodeNext, `.js` extensions on relative imports), Electron main + React renderer, vitest (fork pool capped at 2).

**Spec:** `docs/superpowers/specs/2026-09-03-encoder-codec-picker-design.md`

## Global Constraints

- Code style: 2-space indent, **no semicolons**, single quotes, named exports, `.js` extensions on relative imports. No linter is configured — match surrounding code by hand.
- OBS calls are best-effort: `console.warn`, never throw out. Nothing OBS-side may block boot or go-live.
- Tests: `npm -w @axistream/app run test` and `npm -w @axistream/capture run test`. Cap parallelism per the global rule — the repo's vitest config already uses a fork pool capped at 2; respect it.
- Typecheck gate: `cd packages/app && npx tsc --noEmit -p tsconfig.json`.
- The only `SimpleOutput/StreamEncoder` values OBS 32.1.2 accepts are the twelve in `OBS_SIMPLE_ENCODERS` (Task 1). Any other string silently becomes `obs_x264`.
- AV1 and HEVC rows ship **disabled**: plain RTMP ingest cannot carry them.
- Two branches, in order: `fix/vaapi-silent-x264` (Task 1), then `feat/encoder-picker` (Tasks 2–9) cut from `main` after the first merges.

---

## Part 1 — branch `fix/vaapi-silent-x264`

The spec commit `a3b0d60` is already on this branch. Task 1 lands on top of it.

### Task 1: Stop claiming VAAPI, and guard every encoder string

**Files:**
- Modify: `packages/capture/src/encoder-presets.ts:14-18` (the `ENCODERS` table)
- Modify: `packages/capture/test/encoder-presets.test.ts:5-9`
- Create: `packages/capture/test/obs-encoder-strings.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `OBS_SIMPLE_ENCODERS: readonly string[]` exported from `packages/capture/src/encoder-presets.ts`, re-exported by `packages/capture/src/index.ts` (which already does `export * from './encoder-presets.js'`). Task 2 reuses it.

- [ ] **Step 1: Write the failing guard test**

Create `packages/capture/test/obs-encoder-strings.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { choosePreset, OBS_SIMPLE_ENCODERS, type EncoderKind } from '../src/encoder-presets.js'

const KINDS: EncoderKind[] = ['nvenc', 'vaapi', 'x264']

describe('OBS simple-output encoder strings', () => {
  // The bug this guards: OBS's get_simple_output_encoder()
  // (frontend/utility/SimpleOutput.cpp:88, obs-studio 32.1.2) returns
  // "obs_x264" for ANY string it does not recognize. Writing 'ffmpeg_vaapi'
  // there encoded in software while the stat chip said VAAPI, and no test
  // caught it because every test asserted the string we write, never that
  // OBS honors it.
  it('every streamEncoder AxiStream can emit is one OBS recognizes', () => {
    for (const kind of KINDS) {
      expect(OBS_SIMPLE_ENCODERS).toContain(choosePreset(kind, 1080, 60).streamEncoder)
    }
  })

  it('lists exactly the twelve values OBS 32.1.2 accepts', () => {
    expect([...OBS_SIMPLE_ENCODERS].sort()).toEqual([
      'amd', 'amd_av1', 'amd_hevc', 'apple_h264', 'apple_hevc', 'nvenc',
      'nvenc_av1', 'nvenc_hevc', 'qsv', 'qsv_av1', 'x264', 'x264_lowcpu',
    ])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w @axistream/capture run test -- obs-encoder-strings`
Expected: FAIL — `OBS_SIMPLE_ENCODERS` is not exported (TypeScript/import error).

- [ ] **Step 3: Add the constant and fix the vaapi mapping**

In `packages/capture/src/encoder-presets.ts`, add above the `ENCODERS` table:

```ts
/** The complete set of SimpleOutput/StreamEncoder values OBS recognizes —
 *  get_simple_output_encoder(), frontend/utility/SimpleOutput.cpp:88 in
 *  obs-studio 32.1.2. Anything else silently resolves to obs_x264, which is
 *  how the VAAPI preset shipped software encoding under a "VAAPI" label. */
export const OBS_SIMPLE_ENCODERS = [
  'x264', 'x264_lowcpu', 'qsv', 'qsv_av1', 'nvenc', 'nvenc_av1', 'nvenc_hevc',
  'amd', 'amd_hevc', 'amd_av1', 'apple_h264', 'apple_hevc',
] as const
```

Then replace the `ENCODERS` table body:

```ts
const ENCODERS: Record<EncoderKind, { streamEncoder: string; label: string }> = {
  nvenc: { streamEncoder: 'nvenc', label: 'NVENC' },
  // A DRI render node means AMD/Intel hardware is present, but OBS's *Simple*
  // output mode has no VAAPI mapping — 'ffmpeg_vaapi' is not one of the twelve
  // strings get_simple_output_encoder() knows, so OBS silently ran obs_x264
  // while the stat chip read "VAAPI". Tell the truth instead. Real VAAPI needs
  // Advanced output mode (and writing streamEncoder.json, which
  // SetProfileParameter cannot reach) — see the follow-up in
  // docs/superpowers/specs/2026-09-03-encoder-codec-picker-design.md.
  vaapi: { streamEncoder: 'x264', label: 'x264' },
  x264: { streamEncoder: 'x264', label: 'x264' },
}
```

`detectEncoder` is deliberately left alone: returning `vaapi` for a DRI render node is still true, and it is the only vendor signal in the codebase. Task 4 promotes it into `detectVendor()`.

- [ ] **Step 4: Fix the test that asserts the bug**

In `packages/capture/test/encoder-presets.test.ts`, replace lines 5–9 (the `maps encoder kinds...` test) with:

```ts
  it('maps encoder kinds to simple-mode ini values and labels', () => {
    expect(choosePreset('nvenc', 1080, 60)).toMatchObject({ streamEncoder: 'nvenc', label: 'NVENC' })
    // Not 'ffmpeg_vaapi': OBS's Simple output mode has no VAAPI mapping, so
    // that string silently became obs_x264. See obs-encoder-strings.test.ts.
    expect(choosePreset('vaapi', 1080, 60)).toMatchObject({ streamEncoder: 'x264', label: 'x264' })
    expect(choosePreset('x264', 1080, 60)).toMatchObject({ streamEncoder: 'x264', label: 'x264' })
  })
```

Leave the rest of the file untouched — the bitrate-table test at lines 11+ still passes.

- [ ] **Step 5: Run the capture suite**

Run: `npm -w @axistream/capture run test`
Expected: PASS, all files.

- [ ] **Step 6: Check nothing else asserted the old string**

Run: `grep -rn "ffmpeg_vaapi\|'VAAPI'" packages/ --include='*.ts' --include='*.tsx' | grep -v node_modules`
Expected: no hits outside the comment added in Step 3. If `packages/app` tests assert a `VAAPI` chip label, update them the same way and re-run `npm -w @axistream/app run test`.

- [ ] **Step 7: Typecheck and commit**

```bash
cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..
git add packages/capture/src/encoder-presets.ts packages/capture/test/encoder-presets.test.ts packages/capture/test/obs-encoder-strings.test.ts
git commit -m "fix: stop labelling software x264 as VAAPI

OBS Simple output mode has no VAAPI mapping — get_simple_output_encoder()
(SimpleOutput.cpp:88) returns obs_x264 for any unrecognized string, and
'ffmpeg_vaapi' is not among the twelve it knows. Every AMD/Intel Linux
user has been encoding in software while the stat chip claimed VAAPI.

No behavior change: they were already on x264. Only the label is now true.

Adds OBS_SIMPLE_ENCODERS plus a guard test asserting every string we can
emit is one OBS accepts — the test that would have caught this.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Merge to main**

Follow the repo convention — a merge commit, not a fast-forward:

```bash
git checkout main
git merge --no-ff fix/vaapi-silent-x264 -m "Merge fix/vaapi-silent-x264: stop labelling software x264 as VAAPI"
```

---

## Part 2 — branch `feat/encoder-picker`

```bash
git checkout main && git checkout -b feat/encoder-picker
```

### Task 2: The encoder entry table and availability matrix

**Files:**
- Create: `packages/capture/src/encoder-entries.ts`
- Create: `packages/capture/test/encoder-entries.test.ts`
- Modify: `packages/capture/src/index.ts` (add the export line)

**Interfaces:**
- Consumes: `OBS_SIMPLE_ENCODERS` from Task 1.
- Produces:
  - `type EncoderId = 'auto' | 'x264' | 'nvenc_h264' | 'nvenc_hevc' | 'nvenc_av1' | 'amd_h264' | 'amd_hevc' | 'vaapi_h264'`
  - `type ResolvedEncoderId = Exclude<EncoderId, 'auto'>`
  - `type Vendor = 'nvidia' | 'amd-intel' | 'none'`
  - `type DisabledReason = 'enhanced-rtmp' | 'no-nvidia' | 'no-amd' | 'amf-windows-only' | 'vaapi-advanced-mode'`
  - `interface EncoderEntry { id: ResolvedEncoderId; label: string; streamEncoder: string | null; vendor: Vendor; needsEnhancedRtmp: boolean }`
  - `const ENCODER_ENTRIES: readonly EncoderEntry[]`
  - `function encoderAvailability(entry: EncoderEntry, vendor: Vendor, platform: NodeJS.Platform): 'ok' | DisabledReason`
  - `function encoderEntry(id: ResolvedEncoderId): EncoderEntry`

- [ ] **Step 1: Write the failing test**

Create `packages/capture/test/encoder-entries.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { OBS_SIMPLE_ENCODERS } from '../src/encoder-presets.js'
import { ENCODER_ENTRIES, encoderAvailability, encoderEntry } from '../src/encoder-entries.js'

const linux = 'linux' as NodeJS.Platform
const win = 'win32' as NodeJS.Platform

describe('ENCODER_ENTRIES', () => {
  it('covers every row of the OBS dropdown the request asked for', () => {
    expect(ENCODER_ENTRIES.map((e) => e.id)).toEqual([
      'x264', 'nvenc_h264', 'nvenc_hevc', 'nvenc_av1', 'amd_h264', 'amd_hevc', 'vaapi_h264',
    ])
  })

  it('only emits stream encoder strings OBS recognizes', () => {
    for (const e of ENCODER_ENTRIES) {
      if (e.streamEncoder !== null) expect(OBS_SIMPLE_ENCODERS).toContain(e.streamEncoder)
    }
  })

  it('looks entries up by id', () => {
    expect(encoderEntry('nvenc_av1').streamEncoder).toBe('nvenc_av1')
  })
})

describe('encoderAvailability', () => {
  const of = (id: Parameters<typeof encoderEntry>[0]) => encoderEntry(id)

  it('software always works', () => {
    expect(encoderAvailability(of('x264'), 'none', linux)).toBe('ok')
    expect(encoderAvailability(of('x264'), 'nvidia', win)).toBe('ok')
  })

  it('NVENC H.264 needs an NVIDIA GPU', () => {
    expect(encoderAvailability(of('nvenc_h264'), 'nvidia', linux)).toBe('ok')
    expect(encoderAvailability(of('nvenc_h264'), 'amd-intel', linux)).toBe('no-nvidia')
    expect(encoderAvailability(of('nvenc_h264'), 'none', linux)).toBe('no-nvidia')
  })

  it('HEVC and AV1 are blocked by the RTMP ingest even on the right GPU', () => {
    expect(encoderAvailability(of('nvenc_hevc'), 'nvidia', linux)).toBe('enhanced-rtmp')
    expect(encoderAvailability(of('nvenc_av1'), 'nvidia', linux)).toBe('enhanced-rtmp')
  })

  it('reports the missing GPU before the ingest limit — the more actionable reason', () => {
    expect(encoderAvailability(of('nvenc_av1'), 'amd-intel', linux)).toBe('no-nvidia')
  })

  it('AMF is Windows-only, whatever the GPU', () => {
    expect(encoderAvailability(of('amd_h264'), 'amd-intel', linux)).toBe('amf-windows-only')
    expect(encoderAvailability(of('amd_h264'), 'amd-intel', win)).toBe('ok')
    expect(encoderAvailability(of('amd_h264'), 'nvidia', win)).toBe('no-amd')
    expect(encoderAvailability(of('amd_hevc'), 'amd-intel', win)).toBe('enhanced-rtmp')
  })

  it('VAAPI is never selectable until advanced output mode lands', () => {
    expect(encoderAvailability(of('vaapi_h264'), 'amd-intel', linux)).toBe('vaapi-advanced-mode')
    expect(encoderAvailability(of('vaapi_h264'), 'nvidia', linux)).toBe('vaapi-advanced-mode')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w @axistream/capture run test -- encoder-entries`
Expected: FAIL — cannot resolve `../src/encoder-entries.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/capture/src/encoder-entries.ts`:

```ts
/** One row of the encoder picker. The vocabulary mirrors OBS Studio's own
 *  encoder dropdown, which is what the feature request asked for. */

export type EncoderId =
  | 'auto'
  | 'x264'
  | 'nvenc_h264' | 'nvenc_hevc' | 'nvenc_av1'
  | 'amd_h264' | 'amd_hevc'
  | 'vaapi_h264'

/** Every id except 'auto' — what a resolved selection can actually be. */
export type ResolvedEncoderId = Exclude<EncoderId, 'auto'>

export type Vendor = 'nvidia' | 'amd-intel' | 'none'

export type DisabledReason =
  | 'enhanced-rtmp'
  | 'no-nvidia'
  | 'no-amd'
  | 'amf-windows-only'
  | 'vaapi-advanced-mode'

export interface EncoderEntry {
  id: ResolvedEncoderId
  label: string
  /** The SimpleOutput/StreamEncoder value, or null when the encoder is not
   *  reachable from Simple output mode at all (VAAPI). */
  streamEncoder: string | null
  /** 'none' = runs anywhere. */
  vendor: Vendor
  /** HEVC and AV1 cannot go out over plain RTMP; YouTube ingests them only
   *  over enhanced-RTMP/RTMPS or HLS, and the go-live path builds plain RTMP. */
  needsEnhancedRtmp: boolean
}

export const ENCODER_ENTRIES: readonly EncoderEntry[] = [
  { id: 'x264', label: 'Software (x264)', streamEncoder: 'x264', vendor: 'none', needsEnhancedRtmp: false },
  { id: 'nvenc_h264', label: 'Hardware (NVENC, H.264)', streamEncoder: 'nvenc', vendor: 'nvidia', needsEnhancedRtmp: false },
  { id: 'nvenc_hevc', label: 'Hardware (NVENC, HEVC)', streamEncoder: 'nvenc_hevc', vendor: 'nvidia', needsEnhancedRtmp: true },
  { id: 'nvenc_av1', label: 'Hardware (NVENC, AV1)', streamEncoder: 'nvenc_av1', vendor: 'nvidia', needsEnhancedRtmp: true },
  { id: 'amd_h264', label: 'Hardware (AMD, H.264)', streamEncoder: 'amd', vendor: 'amd-intel', needsEnhancedRtmp: false },
  { id: 'amd_hevc', label: 'Hardware (AMD, HEVC)', streamEncoder: 'amd_hevc', vendor: 'amd-intel', needsEnhancedRtmp: true },
  // No streamEncoder: OBS's Simple output mode has no VAAPI mapping. Present
  // as a permanently-disabled row so Linux AMD/Intel users can see why their
  // hardware is idle instead of guessing. See the spec's follow-up list.
  { id: 'vaapi_h264', label: 'Hardware (VAAPI, H.264)', streamEncoder: null, vendor: 'amd-intel', needsEnhancedRtmp: false },
]

export function encoderEntry(id: ResolvedEncoderId): EncoderEntry {
  const found = ENCODER_ENTRIES.find((e) => e.id === id)
  if (!found) throw new Error(`unknown encoder id: ${id}`)
  return found
}

/** Why a row is unselectable, or 'ok'. Pure — the whole matrix is testable
 *  without OBS. Reasons are ordered most-actionable first: a user with the
 *  wrong GPU is told about the GPU, not about an ingest limit they could not
 *  hit anyway. */
export function encoderAvailability(
  entry: EncoderEntry, vendor: Vendor, platform: NodeJS.Platform,
): 'ok' | DisabledReason {
  if (entry.streamEncoder === null) return 'vaapi-advanced-mode'
  // AMF is the Windows AMD encoder; the Linux builds AxiStream ships do not
  // have it, so an AMD Linux box still cannot use these rows.
  if (entry.vendor === 'amd-intel' && platform !== 'win32') return 'amf-windows-only'
  if (entry.vendor !== 'none' && entry.vendor !== vendor) {
    return entry.vendor === 'nvidia' ? 'no-nvidia' : 'no-amd'
  }
  if (entry.needsEnhancedRtmp) return 'enhanced-rtmp'
  return 'ok'
}
```

- [ ] **Step 4: Export it from the package**

In `packages/capture/src/index.ts`, after line 15 (`export * from './detect-encoders.js'`) add:

```ts
export * from './encoder-entries.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm -w @axistream/capture run test -- encoder-entries`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/capture/src/encoder-entries.ts packages/capture/test/encoder-entries.test.ts packages/capture/src/index.ts
git commit -m "feat: add the encoder entry table and availability matrix

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 3: Vendor detection

**Files:**
- Modify: `packages/capture/src/detect-encoders.ts`
- Modify: `packages/capture/test/detect-encoders.test.ts`

**Interfaces:**
- Consumes: `Vendor` from Task 2.
- Produces: `function detectVendor(d: DetectDeps): Vendor`, exported from `packages/capture/src/detect-encoders.ts`. `detectEncoder` and `DetectDeps` keep their current signatures.

- [ ] **Step 1: Write the failing test**

Append to `packages/capture/test/detect-encoders.test.ts` (the `deps` helper at the top of that file is reused as-is):

```ts
describe('detectVendor', () => {
  it('nvidia device node → nvidia', () => {
    expect(detectVendor(deps({ existsSync: (p) => p === '/dev/nvidiactl' }))).toBe('nvidia')
    expect(detectVendor(deps({ existsSync: (p) => p === '/dev/nvidia0' }))).toBe('nvidia')
  })

  it('DRI render node without nvidia → amd-intel', () => {
    expect(detectVendor(deps({ readdirSync: () => ['card0', 'renderD128'] }))).toBe('amd-intel')
  })

  it('a card node without a render node is not enough', () => {
    expect(detectVendor(deps({ readdirSync: () => ['card0'] }))).toBe('none')
  })

  it('readdir throwing → treated as no DRI', () => {
    expect(detectVendor(deps({ readdirSync: () => { throw new Error('EACCES') } }))).toBe('none')
  })

  // Windows vendor detection is a follow-up; until it exists the picker
  // honestly shows software-only there, which is what already runs.
  it('non-linux → none for now', () => {
    expect(detectVendor(deps({ platform: 'win32', existsSync: () => true }))).toBe('none')
  })
})
```

Also update the import on line 2 of that file:

```ts
import { detectEncoder, detectVendor } from '../src/detect-encoders.js'
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w @axistream/capture run test -- detect-encoders`
Expected: FAIL — `detectVendor` is not exported.

- [ ] **Step 3: Write the implementation**

In `packages/capture/src/detect-encoders.ts`, add the import and the new function, leaving `detectEncoder` untouched:

```ts
import type { Vendor } from './encoder-entries.js'
```

```ts
/** Which GPU vendor the picker should treat as present. Same cheap probe as
 *  detectEncoder — a false positive costs nothing worse than OBS's own
 *  fallback — but expressed as a vendor, which is what the picker gates on. */
export function detectVendor(d: DetectDeps): Vendor {
  if (d.platform !== 'linux') return 'none'
  if (d.existsSync('/dev/nvidiactl') || d.existsSync('/dev/nvidia0')) return 'nvidia'
  try {
    if (d.readdirSync('/dev/dri').some((n) => n.startsWith('renderD'))) return 'amd-intel'
  } catch { /* no DRI access */ }
  return 'none'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w @axistream/capture run test -- detect-encoders`
Expected: PASS — the five existing `detectEncoder` tests plus five new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/capture/src/detect-encoders.ts packages/capture/test/detect-encoders.test.ts
git commit -m "feat: add detectVendor for encoder picker gating

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 4: Resolve a selection to a preset

**Files:**
- Modify: `packages/capture/src/encoder-presets.ts`
- Modify: `packages/capture/test/encoder-presets.test.ts`

**Interfaces:**
- Consumes: `EncoderId`, `ResolvedEncoderId`, `Vendor`, `ENCODER_ENTRIES`, `encoderEntry`, `encoderAvailability` from Tasks 2–3.
- Produces:
  - `function resolveEncoder(id: EncoderId, vendor: Vendor, platform: NodeJS.Platform): ResolvedEncoderId`
  - `function presetFor(id: ResolvedEncoderId, outputHeight: number, fps: number, overrides?: QualityOverrides): EncoderPreset`
  - `choosePreset` and `EncoderKind` remain exported and unchanged, so nothing else breaks mid-plan. Task 7 switches the app over; Task 9 removes them.

- [ ] **Step 1: Write the failing test**

Append to `packages/capture/test/encoder-presets.test.ts`:

```ts
describe('resolveEncoder', () => {
  const linux = 'linux' as NodeJS.Platform

  it('auto picks NVENC H.264 on an NVIDIA box', () => {
    expect(resolveEncoder('auto', 'nvidia', linux)).toBe('nvenc_h264')
  })

  it('auto falls back to software with no usable GPU', () => {
    expect(resolveEncoder('auto', 'amd-intel', linux)).toBe('x264')
    expect(resolveEncoder('auto', 'none', linux)).toBe('x264')
  })

  it('honors an explicit available selection', () => {
    expect(resolveEncoder('nvenc_h264', 'nvidia', linux)).toBe('nvenc_h264')
    expect(resolveEncoder('x264', 'nvidia', linux)).toBe('x264')
  })

  // A persisted id can outlive the GPU it was set on, or the ingest that
  // could carry it. Resolving rather than failing keeps go-live working.
  it('falls back when the stored selection is no longer available', () => {
    expect(resolveEncoder('nvenc_av1', 'nvidia', linux)).toBe('nvenc_h264')
    expect(resolveEncoder('nvenc_h264', 'amd-intel', linux)).toBe('x264')
    expect(resolveEncoder('vaapi_h264', 'amd-intel', linux)).toBe('x264')
  })
})

describe('presetFor', () => {
  it('maps ids to OBS strings and chip labels', () => {
    expect(presetFor('nvenc_h264', 1080, 60)).toMatchObject({ streamEncoder: 'nvenc', label: 'NVENC H.264' })
    expect(presetFor('x264', 1080, 60)).toMatchObject({ streamEncoder: 'x264', label: 'x264' })
  })

  it('shares the bitrate table with choosePreset', () => {
    expect(presetFor('x264', 1440, 60).videoBitrateKbps).toBe(24000)
    expect(presetFor('nvenc_h264', 1080, 30, { videoBitrateKbps: 3000 }).videoBitrateKbps).toBe(3000)
  })
})
```

Update the import on line 2 of that file:

```ts
import { choosePreset, presetFor, resolveEncoder } from '../src/encoder-presets.js'
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w @axistream/capture run test -- encoder-presets`
Expected: FAIL — `presetFor` / `resolveEncoder` are not exported.

- [ ] **Step 3: Write the implementation**

In `packages/capture/src/encoder-presets.ts`, add the import at the top:

```ts
import { encoderAvailability, encoderEntry, type EncoderId, type ResolvedEncoderId, type Vendor } from './encoder-entries.js'
```

Add at the bottom of the file:

```ts
/** Short labels for the stat chip — the picker's own labels are too long for
 *  a chip, and the chip's job is "what is actually encoding right now". */
const CHIP_LABELS: Record<ResolvedEncoderId, string> = {
  x264: 'x264',
  nvenc_h264: 'NVENC H.264',
  nvenc_hevc: 'NVENC HEVC',
  nvenc_av1: 'NVENC AV1',
  amd_h264: 'AMD H.264',
  amd_hevc: 'AMD HEVC',
  vaapi_h264: 'VAAPI H.264',
}

/** The user's selection -> what will actually be written to OBS. 'auto', and
 *  any selection that is no longer available (the GPU changed, or the row was
 *  always ingest-gated), resolves to the best available encoder rather than
 *  failing go-live. */
export function resolveEncoder(id: EncoderId, vendor: Vendor, platform: NodeJS.Platform): ResolvedEncoderId {
  if (id !== 'auto' && encoderAvailability(encoderEntry(id), vendor, platform) === 'ok') return id
  if (vendor === 'nvidia' && encoderAvailability(encoderEntry('nvenc_h264'), vendor, platform) === 'ok') return 'nvenc_h264'
  return 'x264'
}

export function presetFor(
  id: ResolvedEncoderId, outputHeight: number, fps: number, overrides?: QualityOverrides,
): EncoderPreset {
  const entry = encoderEntry(id)
  return {
    // resolveEncoder only ever returns ids with a real OBS string, so the
    // null case (VAAPI) is unreachable here — fall back rather than throw,
    // because nothing encoder-side may block go-live.
    streamEncoder: entry.streamEncoder ?? 'x264',
    label: CHIP_LABELS[id],
    videoBitrateKbps: overrides?.videoBitrateKbps ?? videoBitrate(outputHeight, fps),
    audioBitrateKbps: 160,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w @axistream/capture run test`
Expected: PASS — all capture tests, old and new.

- [ ] **Step 5: Commit**

```bash
git add packages/capture/src/encoder-presets.ts packages/capture/test/encoder-presets.test.ts
git commit -m "feat: resolve an encoder selection to a preset

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 5: Persist the selection, migrating preferSoftware

**Files:**
- Modify: `packages/app/src/main/StreamSettings.ts` (interface ~line 20, `DEFAULT_SETTINGS` ~line 60, the load/validate block ~lines 201 and 218)
- Modify: `packages/app/test/store.test.ts`

**Interfaces:**
- Consumes: `EncoderId` from Task 2.
- Produces: `StreamSettingsData.encoder: EncoderId` (default `'auto'`) and `StreamSettingsData.encoderAuto: boolean` (default `false`). `preferSoftware` and `preferSoftwareAuto` are removed from the interface, `DEFAULT_SETTINGS`, and the load block.

- [ ] **Step 1: Write the failing test**

Add to `packages/app/test/store.test.ts`. Match the existing describe-block style in that file for constructing a settings store over a temp dir — reuse whatever helper it already uses to write a settings JSON and load it; do not invent a new one.

```ts
describe('encoder settings migration', () => {
  it('defaults to auto when nothing is stored', () => {
    const s = loadSettingsFrom({})
    expect(s.encoder).toBe('auto')
    expect(s.encoderAuto).toBe(false)
  })

  // The old boolean meant exactly "force x264".
  it('migrates preferSoftware: true to an explicit x264 selection', () => {
    const s = loadSettingsFrom({ preferSoftware: true, preferSoftwareAuto: true })
    expect(s.encoder).toBe('x264')
    expect(s.encoderAuto).toBe(true)
  })

  it('migrates preferSoftware: false to auto', () => {
    const s = loadSettingsFrom({ preferSoftware: false, preferSoftwareAuto: false })
    expect(s.encoder).toBe('auto')
    expect(s.encoderAuto).toBe(false)
  })

  it('prefers a stored encoder id over the legacy boolean', () => {
    const s = loadSettingsFrom({ encoder: 'nvenc_h264', preferSoftware: true })
    expect(s.encoder).toBe('nvenc_h264')
  })

  it('rejects an unknown encoder id rather than trusting the file', () => {
    expect(loadSettingsFrom({ encoder: 'nvenc_vp9' }).encoder).toBe('auto')
    expect(loadSettingsFrom({ encoder: 42 }).encoder).toBe('auto')
  })
})
```

`loadSettingsFrom(raw)` is a local helper for this describe block — write the settings object to the store's JSON path and call `load()`, following the pattern already used elsewhere in `store.test.ts`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w @axistream/app run test -- store`
Expected: FAIL — `encoder` is not a property of the loaded settings.

- [ ] **Step 3: Write the implementation**

In `packages/app/src/main/StreamSettings.ts`:

Add the import:

```ts
import { ENCODER_ENTRIES, type EncoderId } from '@axistream/capture'
```

In the `StreamSettingsData` interface, replace `preferSoftware: boolean` (line ~20) and the `preferSoftwareAuto` block (lines ~43-45) with:

```ts
  /** The user's encoder choice. 'auto' = detect. Migrated from the old
   *  preferSoftware boolean, which meant exactly 'x264'. */
  encoder: EncoderId
  /** True when the failed-go-live retry chose the encoder, not the user.
   *  Affects the settings panel's help text only, never behavior. */
  encoderAuto: boolean
```

In `DEFAULT_SETTINGS`, replace `preferSoftware: false,` with `encoder: 'auto',` and `preferSoftwareAuto: false,` with `encoderAuto: false,`.

Add the validator near the other read helpers in the file:

```ts
const ENCODER_IDS: readonly EncoderId[] = ['auto', ...ENCODER_ENTRIES.map((e) => e.id)]

/** A settings file can carry an id from a newer build, a hand edit, or the
 *  pre-picker boolean. Anything unrecognized falls back to auto rather than
 *  reaching OBS. */
function readEncoderId(raw: Record<string, unknown>): EncoderId {
  const stored = raw.encoder
  if (typeof stored === 'string' && (ENCODER_IDS as readonly string[]).includes(stored)) return stored as EncoderId
  if (raw.preferSoftware === true) return 'x264'
  return DEFAULT_SETTINGS.encoder
}
```

In the load block, replace the `preferSoftware` line (~201) and the `preferSoftwareAuto` line (~218) with:

```ts
        encoder: readEncoderId(raw),
        encoderAuto: typeof raw.encoderAuto === 'boolean' ? raw.encoderAuto : raw.preferSoftwareAuto === true,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w @axistream/app run test -- store`
Expected: PASS for the new block. Other tests in the app suite will still fail to compile until Tasks 6–8 land — that is expected; do not chase them here.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/StreamSettings.ts packages/app/test/store.test.ts
git commit -m "feat: persist an encoder id, migrating preferSoftware

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 6: Renderer-facing types and the quality mapping

**Files:**
- Modify: `packages/app/src/shared/state.ts:73-93` (`QualityView`, `QualityPatch`, `DEFAULT_QUALITY`)
- Modify: `packages/app/src/main/quality.ts:21-43` (`qualityViewOf`, `qualityPatchOf`)
- Create: `packages/app/test/quality.test.ts`

**Interfaces:**
- Consumes: `EncoderId` from Task 2, `StreamSettingsData.encoder` / `.encoderAuto` from Task 5.
- Produces: `QualityView.encoder: EncoderId`, `QualityView.encoderAuto: boolean`, `QualityPatch.encoder?: EncoderId`. The `preferSoftware` / `preferSoftwareAuto` fields are gone from both.

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/quality.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { qualityViewOf, qualityPatchOf } from '../src/main/quality.js'
import { DEFAULT_SETTINGS } from '../src/main/StreamSettings.js'

describe('qualityViewOf', () => {
  it('surfaces the encoder selection and whether the app chose it', () => {
    const v = qualityViewOf({ ...DEFAULT_SETTINGS, encoder: 'x264', encoderAuto: true })
    expect(v).toMatchObject({ encoder: 'x264', encoderAuto: true })
  })
})

describe('qualityPatchOf', () => {
  it('writes the encoder and clears the app-chose-it explanation', () => {
    // A user touching the picker takes ownership of the choice, so the
    // "AxiStream switched this for you" note stops applying.
    expect(qualityPatchOf({ encoder: 'nvenc_h264' })).toEqual({ encoder: 'nvenc_h264', encoderAuto: false })
  })

  it('leaves the encoder alone when the key is absent', () => {
    expect(qualityPatchOf({ height: 1080 })).toEqual({ qualityHeight: 1080 })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w @axistream/app run test -- quality`
Expected: FAIL — `encoder` is not on `QualityView`.

- [ ] **Step 3: Write the implementation**

In `packages/app/src/shared/state.ts`, add the import (alongside the other `@axistream/capture` type imports in that file):

```ts
import type { EncoderId } from '@axistream/capture'
```

Replace the `preferSoftware` / `preferSoftwareAuto` lines in `QualityView` with:

```ts
  encoder: EncoderId
  encoderAuto: boolean
```

Replace `preferSoftware?: boolean` in `QualityPatch` with:

```ts
  encoder?: EncoderId
```

Replace `DEFAULT_QUALITY` with:

```ts
export const DEFAULT_QUALITY: QualityView = {
  height: null, fps: null, bitrateKbps: null, encoder: 'auto', encoderAuto: false,
}
```

In `packages/app/src/main/quality.ts`, in `qualityViewOf` replace the two `preferSoftware` lines with:

```ts
    encoder: s.encoder,
    encoderAuto: s.encoderAuto,
```

In `qualityPatchOf` replace the `preferSoftware` line with:

```ts
  // A user touching the picker takes ownership of the choice, so the
  // "AxiStream switched this for you" explanation stops applying.
  if ('encoder' in p && p.encoder) { patch.encoder = p.encoder; patch.encoderAuto = false }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w @axistream/app run test -- quality`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/main/quality.ts packages/app/test/quality.test.ts
git commit -m "feat: carry the encoder selection through quality state

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 7: Wire the main process to the selection

**Files:**
- Modify: `packages/app/src/main/index.ts:8` (import), `:535-543` (`detectKind` / `applyEncoderPreset`), `:548-580` (`pendingSoftwareFlip`, `onStartFailure`), `:1278` (`setQuality`)
- Modify: `packages/app/test/stream-controller.test.ts` if it asserts on `preferSoftware`

**Interfaces:**
- Consumes: `resolveEncoder`, `presetFor`, `detectVendor` (Tasks 3–4); `settings.encoder` / `.encoderAuto` (Task 5); `qualityViewOf` / `qualityPatchOf` (Task 6).
- Produces: no new exports — this task makes the app compile and behave against the new types.

- [ ] **Step 1: Update the capture import on line 8**

Replace `detectEncoder, choosePreset` with `detectVendor, resolveEncoder, presetFor` and `type EncoderKind` with `type ResolvedEncoderId` in the long `@axistream/capture` import. Leave `applyEncoderSettings` and `type EncoderPreset` as they are.

- [ ] **Step 2: Replace detectKind and applyEncoderPreset (lines 535-543)**

```ts
  const vendor = detectVendor({ platform: process.platform, existsSync, readdirSync })
  const detectKind = (): ResolvedEncoderId =>
    resolveEncoder(settings.load().encoder, vendor, process.platform)
  let encoderKind: ResolvedEncoderId = detectKind()
  let currentPreset: EncoderPreset | null = null
  const applyEncoderPreset = async (outputHeight: number, fps: number, opts?: { tries?: number }): Promise<boolean> => {
    currentPreset = presetFor(encoderKind, outputHeight, fps, qualityOf(settings.load()).overrides)
    setState({ encoder: currentPreset.label, videoBitrateKbps: currentPreset.videoBitrateKbps })
    return applyEncoderSettings({ call: (r, p) => sidecar.client().call(r as never, p as never), tries: opts?.tries }, currentPreset)
  }
```

`vendor` is computed once at startup — a GPU does not appear mid-session, and the probe reads `/dev`.

- [ ] **Step 3: Update the software-flip persistence (line ~564)**

Replace the `settings.patch({ preferSoftware: true, preferSoftwareAuto: true })` call with:

```ts
        const next = settings.patch({ encoder: 'x264', encoderAuto: true })
```

The surrounding `pendingSoftwareFlip` comment still holds — persist only if the x264 retry actually reaches LIVE — so leave it in place.

- [ ] **Step 4: Update setQuality (line ~1278)**

```ts
      if ('encoder' in p) encoderKind = detectKind()
```

- [ ] **Step 5: Verify the whole app compiles**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..`
Expected: clean. Any remaining `preferSoftware` error points at a file this plan has not touched yet — fix it to use `encoder` and note it in the commit.

- [ ] **Step 6: Run the app suite**

Run: `npm -w @axistream/app run test`
Expected: PASS except renderer tests for the not-yet-built picker (Task 8). If `stream-controller.test.ts` asserts `preferSoftware`, update it to `encoder: 'x264', encoderAuto: true`.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/main/index.ts packages/app/test
git commit -m "feat: resolve the encoder from the persisted selection

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 8: The picker UI

**Files:**
- Modify: `packages/app/src/renderer/components/QualitySettings.tsx` (the `isCustom` line, and the "Software encoding" checkbox block at the end)
- Modify: `packages/app/test/settings-screen.test.tsx`

**Interfaces:**
- Consumes: `ENCODER_ENTRIES`, `encoderAvailability`, `detectVendor` results via state, `QualityView.encoder` / `.encoderAuto` (Tasks 2, 6).
- Produces: no exports — final user-facing surface.

- [ ] **Step 1: Write the failing test**

Add to `packages/app/test/settings-screen.test.tsx`, following the existing render helper in that file:

```ts
describe('encoder picker', () => {
  it('lists every OBS encoder row', () => {
    renderQuality({ encoder: 'auto' })
    expect(screen.getByLabelText('Encoder')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Hardware \(NVENC, AV1\)/ })).toBeInTheDocument()
  })

  it('disables AV1 and HEVC with the ingest reason', () => {
    renderQuality({ encoder: 'auto' }, { vendor: 'nvidia' })
    const av1 = screen.getByRole('option', { name: /Hardware \(NVENC, AV1\)/ }) as HTMLOptionElement
    expect(av1.disabled).toBe(true)
    expect(av1.textContent).toMatch(/enhanced RTMP/)
  })

  it('keeps a stale selection visible instead of silently showing another row', () => {
    // Same principle as phantomHeight: a persisted choice that no longer
    // applies is surfaced, not hidden behind a value the user never picked.
    renderQuality({ encoder: 'nvenc_av1' }, { vendor: 'amd-intel' })
    const sel = screen.getByLabelText('Encoder') as HTMLSelectElement
    expect(sel.value).toBe('nvenc_av1')
  })

  it('explains an encoder the app chose after a failed go-live', () => {
    renderQuality({ encoder: 'x264', encoderAuto: true })
    expect(screen.getByText(/switched to software encoding/)).toBeInTheDocument()
  })

  it('no longer offers the software-encoding checkbox', () => {
    renderQuality({ encoder: 'auto' })
    expect(screen.queryByLabelText('Software encoding')).toBeNull()
  })
})
```

`renderQuality(quality, opts)` is a local helper: render `<QualitySettings>` with `DEFAULT_QUALITY` merged with the given quality slice, and a stubbed `axi`. Follow the existing render helper in `settings-screen.test.tsx` rather than inventing a new pattern.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w @axistream/app run test -- settings-screen`
Expected: FAIL — no element labelled "Encoder".

- [ ] **Step 3: Add the reason copy and the picker**

In `packages/app/src/renderer/components/QualitySettings.tsx`, add the import:

```ts
import { ENCODER_ENTRIES, encoderAvailability, type DisabledReason } from '@axistream/capture'
```

Add above the component:

```ts
/** Short enough to sit inside an <option>; the full sentence goes under the
 *  select when the current selection is the unavailable one. */
const REASON_SHORT: Record<DisabledReason, string> = {
  'enhanced-rtmp': 'needs enhanced RTMP',
  'no-nvidia': 'no NVIDIA GPU detected',
  'no-amd': 'no AMD GPU detected',
  'amf-windows-only': 'Windows only',
  'vaapi-advanced-mode': 'not yet supported',
}

const REASON_LONG: Record<DisabledReason, string> = {
  'enhanced-rtmp': 'This codec needs enhanced RTMP, which the current YouTube ingest does not support yet. AxiStream will use your next best encoder.',
  'no-nvidia': 'No NVIDIA GPU detected on this machine.',
  'no-amd': 'No AMD GPU detected on this machine.',
  'amf-windows-only': 'AMD hardware encoding is only available on Windows.',
  'vaapi-advanced-mode': 'VAAPI needs OBS advanced output mode, which AxiStream does not use yet.',
}
```

Update the `isCustom` line to reflect the new field:

```ts
  const isCustom = q.height !== null || q.fps !== null || q.bitrateKbps !== null || q.encoder !== 'auto'
```

Replace the entire "Software encoding" `<label className="check">` block **and** the `q.preferSoftware && q.preferSoftwareAuto` conditional paragraph that follows it with:

```tsx
        <label>
          <span>Encoder</span>
          <select
            value={q.encoder}
            onChange={(e) => void axi.setQuality({ encoder: e.target.value as typeof q.encoder })}
          >
            <option value="auto">{`Auto (${state.encoder})`}</option>
            {ENCODER_ENTRIES.map((entry) => {
              const avail = encoderAvailability(entry, state.gpuVendor, state.platform)
              return (
                <option key={entry.id} value={entry.id} disabled={avail !== 'ok'}>
                  {avail === 'ok' ? entry.label : `${entry.label} — ${REASON_SHORT[avail]}`}
                </option>
              )
            })}
          </select>
        </label>

        {/* A fallback the app chose is state, not advice — it gets its own
            weight rather than sitting at hint level. */}
        {q.encoder === 'x264' && q.encoderAuto ? (
          <p className="q-fallback">AxiStream switched to software encoding after a stream failed to start — pick your graphics card again to retry it.</p>
        ) : selectedReason ? (
          <p className="q-fallback">{REASON_LONG[selectedReason]}</p>
        ) : (
          <p className="muted">Auto picks the fastest encoder your graphics card supports.</p>
        )}
```

Add above the `return`, next to the `phantomHeight` logic it mirrors:

```ts
  // A persisted selection can outlive the GPU it was set on, or stay blocked
  // by the ingest. Keep it selected and explain it, rather than letting the
  // <select> fall back to a value the user never picked — same reasoning as
  // phantomHeight above.
  const selectedEntry = ENCODER_ENTRIES.find((e) => e.id === q.encoder)
  const selectedAvail = selectedEntry ? encoderAvailability(selectedEntry, state.gpuVendor, state.platform) : 'ok'
  const selectedReason: DisabledReason | null = selectedAvail === 'ok' ? null : selectedAvail
```

- [ ] **Step 4: Publish vendor and platform to the renderer**

The picker needs both. In `packages/app/src/shared/state.ts` add to `AppState` (next to `encoder`):

```ts
  gpuVendor: Vendor
  platform: NodeJS.Platform
```

with `import type { Vendor } from '@axistream/capture'`, and to the initial state object (line ~200):

```ts
  gpuVendor: 'none', platform: 'linux',
```

In `packages/app/src/main/index.ts`, after `vendor` is computed in Task 7 Step 2, seed it into state alongside the other startup `setState` calls:

```ts
  setState({ gpuVendor: vendor, platform: process.platform })
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm -w @axistream/app run test -- settings-screen`
Expected: PASS, 5 new tests.

- [ ] **Step 6: Typecheck and commit**

```bash
cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..
git add packages/app/src/renderer/components/QualitySettings.tsx packages/app/src/shared/state.ts packages/app/src/main/index.ts packages/app/test/settings-screen.test.tsx
git commit -m "feat: add the encoder picker to quality settings

Replaces the Software encoding checkbox. Unavailable rows stay visible
with the reason they cannot be used.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 9: Retire the old API and run the full gate

**Files:**
- Modify: `packages/capture/src/encoder-presets.ts` (remove `EncoderKind`, `ENCODERS`, `choosePreset`)
- Modify: `packages/capture/src/detect-encoders.ts` (remove `detectEncoder`)
- Modify: `packages/capture/test/encoder-presets.test.ts`, `packages/capture/test/detect-encoders.test.ts`
- Modify: `README.md` if it documents the "Software encoding" checkbox

**Interfaces:**
- Consumes: everything above.
- Produces: a clean public surface — `ENCODER_ENTRIES`, `encoderAvailability`, `encoderEntry`, `detectVendor`, `resolveEncoder`, `presetFor`, `applyEncoderSettings`, `OBS_SIMPLE_ENCODERS`.

- [ ] **Step 1: Confirm nothing still uses the old API**

Run: `grep -rn "choosePreset\|detectEncoder\|EncoderKind\|preferSoftware" packages/ --include='*.ts' --include='*.tsx' | grep -v node_modules`
Expected: hits only in the files listed above. If anything else appears, update it before continuing.

- [ ] **Step 2: Delete the superseded exports**

Remove `EncoderKind`, the `ENCODERS` table, and `choosePreset` from `encoder-presets.ts`; keep `videoBitrate`, `EncoderPreset`, `QualityOverrides`, `OBS_SIMPLE_ENCODERS`, `resolveEncoder`, `presetFor`. Remove `detectEncoder` from `detect-encoders.ts`, keeping `DetectDeps` and `detectVendor`.

Update `obs-encoder-strings.test.ts` to iterate `ENCODER_ENTRIES` instead of the deleted `KINDS` list:

```ts
import { describe, it, expect } from 'vitest'
import { OBS_SIMPLE_ENCODERS } from '../src/encoder-presets.js'
import { ENCODER_ENTRIES } from '../src/encoder-entries.js'

describe('OBS simple-output encoder strings', () => {
  it('every streamEncoder AxiStream can emit is one OBS recognizes', () => {
    for (const e of ENCODER_ENTRIES) {
      if (e.streamEncoder !== null) expect(OBS_SIMPLE_ENCODERS).toContain(e.streamEncoder)
    }
  })
})
```

Delete the now-dead `choosePreset` and `detectEncoder` tests from the two test files; the `presetFor`, `resolveEncoder` and `detectVendor` blocks added in Tasks 3–4 cover the same ground.

- [ ] **Step 3: Run the full gate**

```bash
npm -w @axistream/capture run test
npm -w @axistream/app run test
cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..
```

Expected: all green.

- [ ] **Step 4: Update the README if it mentions the checkbox**

Run: `grep -n "Software encoding\|software encoding\|VAAPI" README.md`
If the encoder story is documented there, update it: the checkbox is now a picker, and VAAPI is not currently used on Linux.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: retire choosePreset and detectEncoder

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Manual smoke test on NVIDIA hardware**

Automated tests cannot prove OBS honors the string — that is exactly the gap that let the VAAPI bug ship. Verify by hand:

1. `npm run dev`, open Settings → Quality. The picker shows `Auto (NVENC H.264)` selected.
2. NVENC AV1 and HEVC rows are visible, greyed, reading "needs enhanced RTMP".
3. AMD rows read "Windows only"; the VAAPI row reads "not yet supported".
4. Pick `Software (x264)`, go live, and confirm the stat chip reads `x264`.
5. Pick `Hardware (NVENC, H.264)`, go live, and confirm the chip reads `NVENC H.264` **and** that the OBS log records an NVENC encoder starting — not `obs_x264`. This is the check that would have caught the VAAPI bug.
6. Confirm a settings file carrying `preferSoftware: true` opens with `Software (x264)` selected.

- [ ] **Step 7: Merge**

```bash
git checkout main
git merge --no-ff feat/encoder-picker -m "Merge feat/encoder-picker: choose the encoder vendor and codec"
```

- [ ] **Step 8: Close the Discord thread**

Using the `axi-discord` skill:

```bash
python3 ~/.claude/skills/axi-discord/scripts/discord.py close 1545260554036314163 \
  --comment="Shipped in <version> — Settings → Quality now has an encoder picker with every row from your screenshot. NVENC H.264 and x264 are selectable; AV1 and HEVC are listed but disabled, because YouTube can't ingest them over plain RTMP yet — enhanced RTMP support will light them up. Also fixed a bug this turned up: the VAAPI preset was silently encoding in software."
```

---

## Self-Review

**Spec coverage.** Part 1 → Task 1. Type model → Task 2. `detectVendor` split → Task 3. Resolver and stale-selection fallback → Task 4. Settings + migration → Task 5. `quality.ts` mapping → Task 6. `index.ts` wiring and the `onStartFailure` path → Task 7. UI, disabled rows, `phantomHeight`-style stale handling, re-worded fallback note → Task 8. Testing section → spread across Tasks 1–8, gate in Task 9. Windows note → covered by Task 3's `detectVendor` returning `'none'` on non-Linux and its test. Out-of-scope items are recorded in the spec, untouched here.

**Placeholders.** None — every code step carries real code. Three steps deliberately defer to an existing in-repo pattern rather than inventing one (`loadSettingsFrom` in Task 5, `renderQuality` in Task 8); both name the file whose pattern to follow.

**Type consistency.** `EncoderId` / `ResolvedEncoderId` / `Vendor` / `DisabledReason` are defined once in Task 2 and used unchanged in Tasks 3–8. `encoderAvailability(entry, vendor, platform)` keeps the same argument order everywhere. `presetFor(id, outputHeight, fps, overrides?)` matches `choosePreset`'s shape so Task 7's call site is a rename plus an argument type change. Settings fields are `encoder` / `encoderAuto` in Tasks 5, 6, 7 and 8 alike.
