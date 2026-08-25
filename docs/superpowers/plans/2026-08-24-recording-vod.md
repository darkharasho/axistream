# Recording (VOD) + End-of-Stream Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record locally — while streaming or not — and replace the anticlimactic end of a stream with a summary carrying duration, average bitrate, dropped percentage, watch link, and open-VOD.

**Architecture:** `RecordController` gains a long-form recording lifecycle beside its existing six-second audio test, driven by an independent, fully manual Record control whose state lives in `AppState.recording`. A pure accumulator samples the existing OBS stats tick while live and is snapshotted in `stopStream`, which now transitions to a new terminal `ENDED` phase carrying a `StreamSummary` the stream screen renders in place of the live controls.

**Tech Stack:** Electron 31, React 18, TypeScript (ESM/NodeNext), Vitest 2 + jsdom, obs-websocket via `@axistream/capture`.

**Spec:** `docs/superpowers/specs/2026-08-24-recording-vod-design.md`

## Global Constraints

These apply to every task below. They are not restated per-task.

- **Code style:** 2-space indent, **no semicolons**, single quotes, named exports, `.js` extensions on all relative imports (ESM/NodeNext). No linter is configured — match the surrounding file exactly.
- **OBS calls are best-effort.** `console.warn` and return an error value; never throw out. Nothing in this sub-project may make a go-live or capture path fail.
- **Record paths must be under `$HOME`.** OBS writes from inside its flatpak, whose `/tmp` is a private tmpfs. A path OBS cannot reach makes the output die right after `StartRecord` returns success (`StopRecord` 501, no file).
- **VOD format is `fragmented_mp4`. The audio test keeps plain `'mp4'`.** Never change the audio-test format.
- **`RecQuality` is always `'Stream'`** — the recording shares the stream encoders, so it costs no extra encode.
- **Clipboard is main-process only:** `axi.copyToClipboard`. Never `navigator.clipboard` — it fails silently in this app's renderer.
- **Toasts carry discrete events only; conditions live in `AppState`.** A record output dying is an event. A recording being in progress is a condition.
- **Tests:** `npm -w @axistream/app run test` (vitest, fork pool capped at 2 — do not raise it).
- **Typecheck gate:** `cd packages/app && npx tsc --noEmit -p tsconfig.json`.
- **Branch:** all work happens on `feat/recording-vod`, branched from `main`.

---

## File Structure

**Create:**
- `packages/app/src/main/record-dir.ts` — path validation, default resolution. Pure.
- `packages/app/src/main/stream-summary.ts` — the stats accumulator. Pure.
- `packages/app/src/renderer/components/RecordButton.tsx`
- `packages/app/src/renderer/components/StreamSummaryPanel.tsx`
- `packages/app/src/renderer/components/RecordingSettings.tsx`
- `packages/app/test/record-dir.test.ts`
- `packages/app/test/stream-summary.test.ts`
- `packages/app/test/record-button.test.tsx`
- `packages/app/test/stream-summary-panel.test.tsx`

**Modify:**
- `packages/app/src/shared/state.ts` — `ENDED` phase, `RecordingState`, `StreamSummary`, `recordDir`, five channels, five `AxiApi` methods.
- `packages/app/src/main/StreamSettings.ts` — `recordDir` persistence + migration.
- `packages/app/src/main/RecordController.ts` — `startRecording` / `stopRecording` / `isRecording`, parameterized format.
- `packages/app/src/main/ipc.ts` — five handlers.
- `packages/app/src/preload/index.ts` — five API methods.
- `packages/app/src/main/index.ts` — recording state, guards, accumulator wiring, `stopStream` → `ENDED`, `before-quit`.
- `packages/app/src/renderer/components/StreamScreen.tsx` — mount `RecordButton` and `StreamSummaryPanel`.
- `packages/app/src/renderer/components/SettingsScreen.tsx` — mount `RecordingSettings`.
- `packages/app/test/record-controller.test.ts` — extend.
- `packages/app/test/ipc-contract.test.ts` — extend.

Note the component filename: **`StreamSummaryPanel.tsx`**, not `StreamSummary.tsx`. The type is named `StreamSummary`, and a file exporting a component with the same name as a shared type invites confused imports.

---

### Task 1: Shared types and settings persistence

Foundation for every later task. No behaviour yet — types plus the persisted `recordDir`.

**Files:**
- Modify: `packages/app/src/shared/state.ts`
- Modify: `packages/app/src/main/StreamSettings.ts`
- Test: `packages/app/test/stream-settings.test.ts` (extend; create if absent)

**Interfaces:**
- Consumes: nothing.
- Produces: `StreamPhase` gains `'ENDED'`; `RecordingState`; `StreamSummary`; `AppState.recording`; `AppState.summary`; `StreamSettingsView.recordDir`; `StreamSettingsData.recordDir`.

- [ ] **Step 1: Write the failing test**

Append to `packages/app/test/stream-settings.test.ts`:

```ts
it('defaults recordDir to empty for a settings file written before recording existed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'axi-settings-'))
  const file = join(dir, 'settings.json')
  writeFileSync(file, JSON.stringify({ titleTemplate: 'x', privacy: 'public' }))
  const s = new StreamSettings(file)

  expect(s.load().recordDir).toBe('')
})

it('persists a recordDir through patch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'axi-settings-'))
  const s = new StreamSettings(join(dir, 'settings.json'))

  s.patch({ recordDir: '/home/u/Videos/AxiStream' })

  expect(s.load().recordDir).toBe('/home/u/Videos/AxiStream')
})
```

If the file does not exist, create it with this header:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StreamSettings } from '../src/main/StreamSettings.js'

describe('StreamSettings', () => {
  // tests above go here
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm -w @axistream/app run test -- stream-settings`
Expected: FAIL — `recordDir` is `undefined`, not `''`.

- [ ] **Step 3: Add the shared types**

In `packages/app/src/shared/state.ts`, extend the phase union — `ENDED` goes between `RECONNECTING` and `ERROR`:

```ts
export type StreamPhase =
  | 'SETTING_UP' | 'PREPARING_CAPTURE' | 'CHOOSING_CAPTURE' | 'AWAITING_APPROVAL'
  | 'NEEDS_YOUTUBE' | 'NEEDS_TITLE' | 'READY'
  | 'GOING_LIVE' | 'STARTING_ON_YOUTUBE' | 'LIVE' | 'RECONNECTING' | 'ENDED' | 'ERROR'
```

Add beside the other interfaces, after `LiveStats`:

```ts
/** Local recording. A condition, so it lives here rather than on the toast channel. */
export interface RecordingState {
  active: boolean
  /** Epoch ms. The renderer derives elapsed time from this rather than main
   *  pushing a per-second counter down a second stats channel. */
  startedAt: number | null
  dir: string
  /** Most recent finished recording, for the summary's "Open recording". */
  lastPath: string | null
  error: string | null
}

/** Snapshot taken at End Stream. OBS's stats are instantaneous and vanish once
 *  the stream stops, so every figure here is accumulated live — nothing in this
 *  shape can be recomputed after the fact. */
export interface StreamSummary {
  durationMs: number
  avgBitrateKbps: number
  peakDroppedPct: number
  droppedFrames: number
  droppedPct: number
  encoder: string
  watchUrl: string | null
  /** A recording that finished during this stream. */
  recordingPath: string | null
  /** A recording still running when the stream ended — the normal case, since
   *  Record is fully manual and End Stream does not stop it. */
  recordingStillActive: boolean
  endedWithError: boolean
}
```

Extend `AppState` (after `watchUrl`) and `INITIAL_STATE` to match:

```ts
  recording: RecordingState
  summary: StreamSummary | null
```

```ts
  recording: { active: false, startedAt: null, dir: '', lastPath: null, error: null },
  summary: null,
```

Extend `StreamSettingsView` with `recordDir: string` (append after `discordMessage`).

Add to `CH`, after `exportDiagnostics`:

```ts
  startRecording: 'axi:startRecording',
  stopRecording: 'axi:stopRecording',
  chooseRecordDir: 'axi:chooseRecordDir',
  openRecording: 'axi:openRecording',
  dismissSummary: 'axi:dismissSummary',
```

Add the result types beside `DiagnosticsResult`:

```ts
export interface RecordStartResult { ok: boolean; error?: string }
export interface RecordStopResult { ok: boolean; outputPath?: string; error?: string }
export interface ChooseDirResult { ok: boolean; dir?: string; error?: string }
export interface OpenResult { ok: boolean; error?: string }
```

Add to `AxiApi`, after `exportDiagnostics`:

```ts
  startRecording(): Promise<RecordStartResult>
  stopRecording(): Promise<RecordStopResult>
  chooseRecordDir(): Promise<ChooseDirResult>
  openRecording(path: string): Promise<OpenResult>
  dismissSummary(): Promise<void>
```

- [ ] **Step 4: Add settings persistence**

In `packages/app/src/main/StreamSettings.ts`: add `recordDir: string` to `StreamSettingsData` (after `lastSeenVersion`), add `recordDir: ''` to `DEFAULT_SETTINGS`, and add to the load-time sanitizer beside the `lastSeenVersion` line:

```ts
        recordDir: typeof raw.recordDir === 'string' ? raw.recordDir : DEFAULT_SETTINGS.recordDir,
```

The default is `''`, not a path. It is resolved to a real directory at load time in Task 6, so the default follows the user's actual home rather than being frozen into a settings file at first run.

- [ ] **Step 5: Run the tests**

Run: `npm -w @axistream/app run test -- stream-settings`
Expected: PASS.

Then `cd packages/app && npx tsc --noEmit -p tsconfig.json`. Expect errors only in `viewOf` (missing `recordDir`) — fix by adding `recordDir: s.recordDir` to the `viewOf` literal in `src/main/index.ts`. Everything else should compile, because `AppState` additions have defaults in `INITIAL_STATE`.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/main/StreamSettings.ts packages/app/src/main/index.ts packages/app/test/stream-settings.test.ts
git commit -m "feat(state): recording state, stream summary, and recordDir persistence"
```

---

### Task 2: Record directory validation

**Files:**
- Create: `packages/app/src/main/record-dir.ts`
- Test: `packages/app/test/record-dir.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `defaultRecordDir(home: string): string`, `validateRecordDir(dir: string, home: string): { ok: boolean; error?: string }`, `RECORD_DIR_ERROR: string`.

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/record-dir.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { defaultRecordDir, validateRecordDir, RECORD_DIR_ERROR } from '../src/main/record-dir.js'

const HOME = '/home/u'

describe('defaultRecordDir', () => {
  it('is Videos/AxiStream under the given home', () => {
    expect(defaultRecordDir(HOME)).toBe('/home/u/Videos/AxiStream')
  })
})

describe('validateRecordDir', () => {
  it('accepts a path inside home', () => {
    expect(validateRecordDir('/home/u/Videos/AxiStream', HOME)).toEqual({ ok: true })
  })

  it('accepts home itself', () => {
    expect(validateRecordDir('/home/u', HOME)).toEqual({ ok: true })
  })

  it('rejects a path outside home', () => {
    expect(validateRecordDir('/mnt/games/vods', HOME)).toEqual({ ok: false, error: RECORD_DIR_ERROR })
  })

  it('rejects a sibling directory that merely shares the home prefix', () => {
    expect(validateRecordDir('/home/user2/vods', HOME)).toEqual({ ok: false, error: RECORD_DIR_ERROR })
  })

  it('rejects a traversal that escapes home', () => {
    expect(validateRecordDir('/home/u/../other/vods', HOME)).toEqual({ ok: false, error: RECORD_DIR_ERROR })
  })

  it('rejects an empty path', () => {
    expect(validateRecordDir('', HOME).ok).toBe(false)
  })
})
```

The sibling case is the one that matters: a naive `startsWith(home)` accepts `/home/user2` because `'/home/user2'.startsWith('/home/u')` is true. That bug would hand OBS an unwritable path and produce the exact silent-death failure this validation exists to prevent.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm -w @axistream/app run test -- record-dir`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/app/src/main/record-dir.ts`:

```ts
import { join, resolve, sep } from 'node:path'

/** OBS writes recordings from inside its flatpak, whose /tmp is a private
 *  tmpfs. $HOME is the one tree mapped identically inside the sandbox — a path
 *  outside it makes the output die right after StartRecord reports success. */
export const RECORD_DIR_ERROR =
  "must be inside your home folder (AxiStream's OBS can't write outside it)"

export function defaultRecordDir(home: string): string {
  return join(home, 'Videos', 'AxiStream')
}

export function validateRecordDir(dir: string, home: string): { ok: boolean; error?: string } {
  if (!dir) return { ok: false, error: RECORD_DIR_ERROR }
  const target = resolve(dir)
  const root = resolve(home)
  // The trailing separator is load-bearing: a bare startsWith accepts
  // /home/user2 for a home of /home/u.
  if (target !== root && !target.startsWith(root + sep)) return { ok: false, error: RECORD_DIR_ERROR }
  return { ok: true }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm -w @axistream/app run test -- record-dir`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/record-dir.ts packages/app/test/record-dir.test.ts
git commit -m "feat(record): validate record directories against \$HOME"
```

---

### Task 3: Stream summary accumulator

**Files:**
- Create: `packages/app/src/main/stream-summary.ts`
- Test: `packages/app/test/stream-summary.test.ts`

**Interfaces:**
- Consumes: `LiveStats`, `StreamSummary` from `../shared/state.js`.
- Produces: `createSummaryAccumulator(): SummaryAccumulator` with `sample(s: LiveStats): void`, `snapshot(extra: SummaryExtra): StreamSummary`, `reset(): void`; `SummaryExtra = { watchUrl: string | null; recordingPath: string | null; recordingStillActive: boolean; endedWithError: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/stream-summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createSummaryAccumulator } from '../src/main/stream-summary.js'
import type { LiveStats } from '../src/shared/state.js'

const stat = (p: Partial<LiveStats>): LiveStats => ({
  bitrateKbps: 0, droppedFrames: 0, droppedPct: 0, durationMs: 0,
  encoder: 'NVENC H.264', cpuPct: 0, reconnecting: false, ...p,
})

const EXTRA = { watchUrl: null, recordingPath: null, recordingStillActive: false, endedWithError: false }

describe('createSummaryAccumulator', () => {
  it('averages bitrate excluding zero samples', () => {
    const a = createSummaryAccumulator()
    // OBS reports 0 on the first tick or two and during a reconnect; averaging
    // those in would understate a healthy stream.
    a.sample(stat({ bitrateKbps: 0 }))
    a.sample(stat({ bitrateKbps: 6000 }))
    a.sample(stat({ bitrateKbps: 6200 }))

    expect(a.snapshot(EXTRA).avgBitrateKbps).toBe(6100)
  })

  it('takes cumulative dropped figures from the last sample', () => {
    const a = createSummaryAccumulator()
    a.sample(stat({ droppedFrames: 10, droppedPct: 0.5 }))
    a.sample(stat({ droppedFrames: 42, droppedPct: 0.2 }))

    const s = a.snapshot(EXTRA)
    expect(s.droppedFrames).toBe(42)
    expect(s.droppedPct).toBe(0.2)
  })

  it('retains the peak dropped percentage even after it recovers', () => {
    const a = createSummaryAccumulator()
    a.sample(stat({ droppedPct: 0.1 }))
    a.sample(stat({ droppedPct: 3.4 }))
    a.sample(stat({ droppedPct: 0.2 }))

    expect(a.snapshot(EXTRA).peakDroppedPct).toBe(3.4)
  })

  it('takes duration and encoder from the last sample', () => {
    const a = createSummaryAccumulator()
    a.sample(stat({ durationMs: 1000, encoder: 'NVENC H.264' }))
    a.sample(stat({ durationMs: 7_200_000, encoder: 'x264' }))

    const s = a.snapshot(EXTRA)
    expect(s.durationMs).toBe(7_200_000)
    expect(s.encoder).toBe('x264')
  })

  it('yields zeros rather than NaN when no samples arrived', () => {
    const a = createSummaryAccumulator()

    const s = a.snapshot(EXTRA)
    expect(s.avgBitrateKbps).toBe(0)
    expect(s.durationMs).toBe(0)
    expect(s.droppedFrames).toBe(0)
    expect(Number.isNaN(s.avgBitrateKbps)).toBe(false)
  })

  it('yields zero average when every sample was zero', () => {
    const a = createSummaryAccumulator()
    a.sample(stat({ bitrateKbps: 0 }))
    a.sample(stat({ bitrateKbps: 0 }))

    expect(a.snapshot(EXTRA).avgBitrateKbps).toBe(0)
  })

  it('passes the extras straight through', () => {
    const a = createSummaryAccumulator()
    a.sample(stat({ bitrateKbps: 6000 }))

    const s = a.snapshot({
      watchUrl: 'https://youtu.be/abc', recordingPath: '/home/u/v.mp4',
      recordingStillActive: true, endedWithError: true,
    })
    expect(s.watchUrl).toBe('https://youtu.be/abc')
    expect(s.recordingPath).toBe('/home/u/v.mp4')
    expect(s.recordingStillActive).toBe(true)
    expect(s.endedWithError).toBe(true)
  })

  it('clears everything on reset', () => {
    const a = createSummaryAccumulator()
    a.sample(stat({ bitrateKbps: 6000, durationMs: 9000, droppedFrames: 5 }))
    a.reset()

    const s = a.snapshot(EXTRA)
    expect(s.avgBitrateKbps).toBe(0)
    expect(s.durationMs).toBe(0)
    expect(s.droppedFrames).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm -w @axistream/app run test -- stream-summary`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/app/src/main/stream-summary.ts`:

```ts
import type { LiveStats, StreamSummary } from '../shared/state.js'

export interface SummaryExtra {
  watchUrl: string | null
  recordingPath: string | null
  recordingStillActive: boolean
  endedWithError: boolean
}

export interface SummaryAccumulator {
  sample(s: LiveStats): void
  snapshot(extra: SummaryExtra): StreamSummary
  reset(): void
}

/**
 * Accumulates the figures the end-of-stream summary reports.
 *
 * OBS's stats are instantaneous and gone once the stream stops, so nothing here
 * can be recomputed after the fact — the summary is only as good as what was
 * sampled while live.
 */
export function createSummaryAccumulator(): SummaryAccumulator {
  let bitrateSum = 0
  let bitrateCount = 0
  let peakDroppedPct = 0
  let last: LiveStats | null = null

  return {
    sample(s) {
      // Skip zero bitrate: OBS reports it on the first tick or two and during a
      // reconnect, and averaging those in makes a healthy stream look bad.
      if (s.bitrateKbps > 0) { bitrateSum += s.bitrateKbps; bitrateCount++ }
      if (s.droppedPct > peakDroppedPct) peakDroppedPct = s.droppedPct
      last = s
    },
    snapshot(extra) {
      return {
        durationMs: last?.durationMs ?? 0,
        avgBitrateKbps: bitrateCount ? Math.round(bitrateSum / bitrateCount) : 0,
        peakDroppedPct,
        // Cumulative for the session in OBS, so the last sample is authoritative.
        droppedFrames: last?.droppedFrames ?? 0,
        droppedPct: last?.droppedPct ?? 0,
        encoder: last?.encoder ?? '',
        ...extra,
      }
    },
    reset() {
      bitrateSum = 0
      bitrateCount = 0
      peakDroppedPct = 0
      last = null
    },
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm -w @axistream/app run test -- stream-summary`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/stream-summary.ts packages/app/test/stream-summary.test.ts
git commit -m "feat(summary): accumulate live stats into an end-of-stream snapshot"
```

---

### Task 4: RecordController long-form recording

**Files:**
- Modify: `packages/app/src/main/RecordController.ts`
- Test: `packages/app/test/record-controller.test.ts` (extend)

**Interfaces:**
- Consumes: `RecordStartResult`, `RecordStopResult` from `../shared/state.js`.
- Produces: `RecordFormat = 'mp4' | 'fragmented_mp4'`; `RecordController.startRecording(dir: string, format: RecordFormat): Promise<RecordStartResult>`; `.stopRecording(): Promise<RecordStopResult>`; `.isRecording(): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/test/record-controller.test.ts`. The existing `harness()` helper at the top of the file already returns `{ calls, sleeps, ctl }` and stubs `StopRecord` → `{ outputPath: '/tmp/clip.mp4' }` and `GetRecordStatus` → `{ outputActive: true }` — reuse it as-is.

```ts
describe('RecordController.startRecording', () => {
  it('sets all three profile parameters with the requested format', async () => {
    const h = harness()

    const r = await h.ctl.startRecording('/home/u/Videos/AxiStream', 'fragmented_mp4')

    expect(r).toEqual({ ok: true })
    const params = h.calls.filter((c) => c.req === 'SetProfileParameter').map((c) => c.data)
    expect(params).toEqual([
      { parameterCategory: 'SimpleOutput', parameterName: 'FilePath', parameterValue: '/home/u/Videos/AxiStream' },
      { parameterCategory: 'SimpleOutput', parameterName: 'RecFormat2', parameterValue: 'fragmented_mp4' },
      { parameterCategory: 'SimpleOutput', parameterName: 'RecQuality', parameterValue: 'Stream' },
    ])
  })

  it('verifies the output actually went active before reporting success', async () => {
    // StartRecord resolving only means the request was accepted — an
    // unreachable FilePath kills the output immediately afterward.
    const h = harness({ GetRecordStatus: { outputActive: false } })

    const r = await h.ctl.startRecording('/nope', 'fragmented_mp4')

    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/record folder/i)
  })

  it('reports failure when StartRecord itself throws', async () => {
    const h = harness({ StartRecord: new Error('boom') })

    const r = await h.ctl.startRecording('/home/u/v', 'fragmented_mp4')

    expect(r).toEqual({ ok: false, error: 'boom' })
  })

  it('does not sleep for a record duration — it returns as soon as the output is verified', async () => {
    const h = harness()

    await h.ctl.startRecording('/home/u/v', 'fragmented_mp4')

    expect(h.sleeps).toEqual([300])
  })
})

describe('RecordController.stopRecording', () => {
  it('returns the output path OBS reports', async () => {
    const h = harness()

    expect(await h.ctl.stopRecording()).toEqual({ ok: true, outputPath: '/tmp/clip.mp4' })
  })

  it('retries StopRecord once before giving up', async () => {
    const h = harness({ StopRecord: new Error('not stopped') })

    const r = await h.ctl.stopRecording()

    expect(r).toEqual({ ok: false, error: 'not stopped' })
    expect(h.calls.filter((c) => c.req === 'StopRecord')).toHaveLength(2)
  })
})

describe('RecordController.isRecording', () => {
  it('reflects outputActive', async () => {
    expect(await harness().ctl.isRecording()).toBe(true)
    expect(await harness({ GetRecordStatus: { outputActive: false } }).ctl.isRecording()).toBe(false)
  })

  it('reports false when the status call fails', async () => {
    expect(await harness({ GetRecordStatus: new Error('down') }).ctl.isRecording()).toBe(false)
  })
})

describe('recordTestClip is unaffected by VOD recording', () => {
  it('still writes plain mp4 after a fragmented_mp4 recording set the profile', async () => {
    const h = harness()
    await h.ctl.startRecording('/home/u/v', 'fragmented_mp4')
    h.calls.length = 0

    await h.ctl.recordTestClip(6000, '/tmp/audiotest')

    const formats = h.calls
      .filter((c) => c.req === 'SetProfileParameter' && c.data.parameterName === 'RecFormat2')
      .map((c) => c.data.parameterValue)
    expect(formats).toEqual(['mp4'])
  })
})
```

That last test is the guard against the shared-profile hazard: both paths write the same `SimpleOutput` parameters, so neither may rely on inherited values.

- [ ] **Step 2: Run and confirm failure**

Run: `npm -w @axistream/app run test -- record-controller`
Expected: FAIL — `startRecording is not a function`.

- [ ] **Step 3: Implement**

In `packages/app/src/main/RecordController.ts`, add the format type near the top and refactor the parameter-setting into a shared private helper. Keep `recordTestClip` behaviourally identical — it now passes `'mp4'` explicitly.

```ts
export type RecordFormat = 'mp4' | 'fragmented_mp4'
export interface RecordStartResult { ok: boolean; error?: string }
export interface RecordStopResult { ok: boolean; outputPath?: string; error?: string }
```

Add these methods to the class:

```ts
  private async setParams(dir: string, format: RecordFormat): Promise<void> {
    const c = this.d.client()
    const set = (parameterName: string, parameterValue: string) =>
      c.call('SetProfileParameter', { parameterCategory: 'SimpleOutput', parameterName, parameterValue })
    await set('FilePath', dir)
    // Always explicit: the audio test and VOD recording share one OBS profile,
    // so neither may inherit whatever the other last wrote.
    await set('RecFormat2', format)
    // 'Stream' shares the stream encoders — no extra encode, and the recorded
    // audio path is byte-identical to what viewers hear.
    await set('RecQuality', 'Stream')
  }

  /** Starts a long-form recording. Best-effort — never throws. */
  async startRecording(dir: string, format: RecordFormat): Promise<RecordStartResult> {
    const c = this.d.client()
    const sleep = this.d.sleep ?? defaultSleep
    try {
      await this.setParams(dir, format)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.warn('[record] setting record params failed', error)
      return { ok: false, error }
    }
    try {
      await c.call('StartRecord')
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.warn('[record] StartRecord failed', error)
      return { ok: false, error }
    }
    // StartRecord only means "request accepted" — the output can die right
    // after (a FilePath that doesn't exist inside OBS's flatpak namespace).
    await sleep(300)
    try {
      const st = await c.call('GetRecordStatus') as { outputActive?: boolean }
      if (!st.outputActive) {
        return { ok: false, error: 'recording did not start — is the record folder writable by OBS?' }
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.warn('[record] GetRecordStatus failed', error)
      return { ok: false, error }
    }
    return { ok: true }
  }

  /** Stops a long-form recording. Does not wait for file stability — fragmented
   *  mp4 needs no moov fixup, and the UI must not block after a stop. */
  async stopRecording(): Promise<RecordStopResult> {
    const c = this.d.client()
    let lastError = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await c.call('StopRecord') as { outputPath?: string }
        return { ok: true, outputPath: r.outputPath }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
      }
    }
    console.warn('[record] StopRecord failed', lastError)
    return { ok: false, error: lastError }
  }

  async isRecording(): Promise<boolean> {
    try {
      const st = await this.d.client().call('GetRecordStatus') as { outputActive?: boolean }
      return Boolean(st.outputActive)
    } catch {
      return false
    }
  }
```

Then rewrite `recordTestClip`'s parameter block to call `await this.setParams(dir, 'mp4')` inside its existing try/catch, leaving the rest of that method untouched.

- [ ] **Step 4: Run the tests**

Run: `npm -w @axistream/app run test -- record-controller`
Expected: PASS — the pre-existing `recordTestClip` tests included. If any of those now fail, `setParams` changed the call order; the order must stay `FilePath`, `RecFormat2`, `RecQuality`.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/RecordController.ts packages/app/test/record-controller.test.ts
git commit -m "feat(record): long-form recording lifecycle on RecordController"
```

---

### Task 5: IPC channels and preload

**Files:**
- Modify: `packages/app/src/main/ipc.ts`
- Modify: `packages/app/src/preload/index.ts`
- Test: `packages/app/test/ipc-contract.test.ts` (extend)

**Interfaces:**
- Consumes: `CH` and the result types from Task 1.
- Produces: five registered handlers, five preload methods.

- [ ] **Step 1: Write the failing test**

In `packages/app/test/ipc-contract.test.ts`, add the five channels to the `commandChannels` array in the first test, and append a new test:

```ts
it('forwards the recording path through openRecording IPC', async () => {
  const registered = new Map<string, (...args: any[]) => any>()
  const openRecording = vi.fn()
  registerIpc({
    ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => registered.set(channel, handler) } as any,
    handlers: { openRecording } as any,
    bindPush: () => {},
  })

  await registered.get(CH.openRecording)?.({}, '/home/u/Videos/AxiStream/a.mp4')

  expect(openRecording).toHaveBeenCalledWith('/home/u/Videos/AxiStream/a.mp4')
})
```

In the `commandChannels` array add:

```ts
      CH.startRecording, CH.stopRecording, CH.chooseRecordDir, CH.openRecording, CH.dismissSummary,
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm -w @axistream/app run test -- ipc-contract`
Expected: FAIL — `handled.has(CH.startRecording)` is false.

- [ ] **Step 3: Implement**

In `packages/app/src/main/ipc.ts`, extend the type import to include `RecordStartResult`, `RecordStopResult`, `ChooseDirResult`, `OpenResult`; add to `IpcHandlers` after `exportDiagnostics`:

```ts
  startRecording(): Promise<RecordStartResult>
  stopRecording(): Promise<RecordStopResult>
  chooseRecordDir(): Promise<ChooseDirResult>
  openRecording(path: string): Promise<OpenResult>
  dismissSummary(): Promise<void>
```

And register them after the `exportDiagnostics` line:

```ts
  ipcMain.handle(CH.startRecording, () => handlers.startRecording())
  ipcMain.handle(CH.stopRecording, () => handlers.stopRecording())
  ipcMain.handle(CH.chooseRecordDir, () => handlers.chooseRecordDir())
  ipcMain.handle(CH.openRecording, (_e: unknown, path: string) => handlers.openRecording(path))
  ipcMain.handle(CH.dismissSummary, () => handlers.dismissSummary())
```

In `packages/app/src/preload/index.ts`, extend the type import the same way and add after `exportDiagnostics`:

```ts
  startRecording: () => ipcRenderer.invoke(CH.startRecording) as Promise<RecordStartResult>,
  stopRecording: () => ipcRenderer.invoke(CH.stopRecording) as Promise<RecordStopResult>,
  chooseRecordDir: () => ipcRenderer.invoke(CH.chooseRecordDir) as Promise<ChooseDirResult>,
  openRecording: (path: string) => ipcRenderer.invoke(CH.openRecording, path) as Promise<OpenResult>,
  dismissSummary: () => ipcRenderer.invoke(CH.dismissSummary) as Promise<void>,
```

- [ ] **Step 4: Run the tests**

Run: `npm -w @axistream/app run test -- ipc-contract`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/ipc.ts packages/app/src/preload/index.ts packages/app/test/ipc-contract.test.ts
git commit -m "feat(ipc): recording and summary channels"
```

---

### Task 6: Main-process wiring

The integration task. No new unit test file — `index.ts` is not unit-tested in this codebase (its logic lives in the extracted modules already covered by Tasks 2–4). Verification is the typecheck plus the full suite plus the manual smoke in Task 10.

**Files:**
- Modify: `packages/app/src/main/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: the five handler implementations; `AppState.recording` and `AppState.summary` kept current.

- [ ] **Step 1: Add imports and module state**

Add to the imports at the top of `packages/app/src/main/index.ts`:

```ts
import { shell, dialog } from 'electron'   // merge into the existing electron import
import { defaultRecordDir, validateRecordDir, RECORD_DIR_ERROR } from './record-dir.js'
import { createSummaryAccumulator } from './stream-summary.js'
```

`shell` and `dialog` may already be partly imported — merge rather than adding a second `from 'electron'` line.

Near `const recorder = new RecordController(...)` (line ~273) add:

```ts
  const summaryAcc = createSummaryAccumulator()
  // OBS has exactly one record output, so the six-second audio test and a VOD
  // recording cannot coexist. This flag is the audio test's half of the
  // mutual exclusion; the VOD's half is state.recording.active.
  let audioTestInFlight = false

  const resolveRecordDir = () => {
    const saved = settings.load().recordDir
    // Stored empty by default so the path follows the user's actual home
    // rather than being frozen into a settings file at first run.
    return saved || defaultRecordDir(app.getPath('home'))
  }
```

- [ ] **Step 2: Seed the recording state at boot**

Immediately after the initial `setState` that establishes capture/settings state (search for the first `setState({ phase: goReadyPhase()` in `provision`, and instead place this beside where `settings` is first loaded during startup), add:

```ts
  setState({ recording: { ...state.recording, dir: resolveRecordDir() } })
```

- [ ] **Step 3: Feed the accumulator from the stats tick**

Change the `onStats` line in the `StreamController` construction (line ~370) from:

```ts
    onStats: (s) => push(CH.evtStats, s),
```

to:

```ts
    onStats: (s) => { summaryAcc.sample(s); push(CH.evtStats, s) },
```

- [ ] **Step 4: Reset the accumulator on go-live**

In the `goLive` handler, immediately after `setState({ phase: 'GOING_LIVE' })`, add:

```ts
      summaryAcc.reset()
      setState({ summary: null })
```

- [ ] **Step 5: Rewrite `stopStream` to produce the summary**

Replace the one-line `stopStream` handler (line ~506):

```ts
    stopStream: async () => {
      liveWatchStop = true
      setState({ liveUnconfirmed: false })
      // Snapshot before stopping: OBS's stats are instantaneous and gone once
      // the output closes, so nothing here can be recovered afterward.
      const summary = summaryAcc.snapshot({
        watchUrl: state.watchUrl,
        recordingPath: state.recording.lastPath,
        recordingStillActive: state.recording.active,
        endedWithError: state.phase === 'ERROR' || state.liveUnconfirmed,
      })
      await stream.stop()
      // stream.stop() drives onPhase to READY; the summary phase must win, so
      // it is set after.
      setState({ phase: 'ENDED', summary })
    },
```

The ordering comment matters: `stream.stop()` triggers `onPhase('READY')`, which calls `setState({ phase: 'READY' })`. Setting `ENDED` before the stop would be immediately overwritten.

Note `endedWithError` reads `state.liveUnconfirmed` — capture it into a local **before** the `setState({ liveUnconfirmed: false })` above, or it will always read false:

```ts
    stopStream: async () => {
      const wasUnconfirmed = state.liveUnconfirmed
      liveWatchStop = true
      setState({ liveUnconfirmed: false })
      const summary = summaryAcc.snapshot({
        watchUrl: state.watchUrl,
        recordingPath: state.recording.lastPath,
        recordingStillActive: state.recording.active,
        endedWithError: state.phase === 'ERROR' || wasUnconfirmed,
      })
      await stream.stop()
      setState({ phase: 'ENDED', summary })
    },
```

Use this second version. The first is shown only to make the bug visible.

- [ ] **Step 6: Clear `ENDED` where a new session begins**

At the top of the `goLive` handler, and inside `repairCapture` and `switchSource` where they call `setState({ phase: goReadyPhase(), ... })`, ensure `summary: null` is included so a stale summary cannot outlive its session. For `goLive` this is already covered by Step 4.

For `repairCapture` and `switchSource`, add `summary: null` to their existing `setState` literals.

- [ ] **Step 7: Guard the audio test**

Change the `recordAudioTest` guard (line ~714) from:

```ts
      if (stream.isLive() || state.phase === 'GOING_LIVE' || !state.capture) {
```

to:

```ts
      // OBS has one record output — a VOD recording and this test cannot coexist.
      if (stream.isLive() || state.phase === 'GOING_LIVE' || !state.capture || state.recording.active) {
```

and wrap the body so `audioTestInFlight` is set true immediately after the guard and reset in a `finally`. The simplest correct shape:

```ts
    recordAudioTest: async () => {
      if (stream.isLive() || state.phase === 'GOING_LIVE' || !state.capture || state.recording.active) {
        return { ok: false, error: 'not available right now' }
      }
      audioTestInFlight = true
      try {
        // ... existing body verbatim ...
      } finally {
        audioTestInFlight = false
      }
    },
```

Keep the existing body — including the `$HOME`-based `audiotest` dir comment, the `waitForStableFile` / `hasTopLevelMoov` loop, and the `mp4` expectations — completely unchanged.

- [ ] **Step 8: Add the five handlers**

Add after the `exportDiagnostics` handler:

```ts
    startRecording: async () => {
      if (audioTestInFlight) return { ok: false, error: 'an audio test is running' }
      if (state.recording.active) return { ok: false, error: 'already recording' }
      const dir = resolveRecordDir()
      const v = validateRecordDir(dir, app.getPath('home'))
      if (!v.ok) {
        setState({ recording: { ...state.recording, error: v.error ?? RECORD_DIR_ERROR } })
        toast(win, { kind: 'error', message: 'Recording folder is not usable', detail: v.error })
        return { ok: false, error: v.error }
      }
      await fsPromises.mkdir(dir, { recursive: true }).catch(() => {})
      const r = await recorder.startRecording(dir, 'fragmented_mp4')
      if (!r.ok) {
        setState({ recording: { ...state.recording, active: false, startedAt: null, error: r.error ?? 'failed' } })
        toast(win, { kind: 'error', message: 'Recording failed to start', detail: r.error })
        return r
      }
      setState({ recording: { ...state.recording, active: true, startedAt: Date.now(), dir, error: null } })
      return r
    },

    stopRecording: async () => {
      if (!state.recording.active) return { ok: false, error: 'not recording' }
      const r = await recorder.stopRecording()
      if (!r.ok) {
        setState({ recording: { ...state.recording, active: false, startedAt: null, error: r.error ?? 'failed' } })
        toast(win, { kind: 'error', message: 'Recording did not stop cleanly', detail: r.error })
        return r
      }
      setState({ recording: { ...state.recording, active: false, startedAt: null, lastPath: r.outputPath ?? null, error: null } })
      // If the summary is on screen, refresh it in place so "Still recording"
      // becomes "Open recording" without dismissing the panel.
      if (state.phase === 'ENDED' && state.summary) {
        setState({ summary: { ...state.summary, recordingStillActive: false, recordingPath: r.outputPath ?? null } })
      }
      return r
    },

    chooseRecordDir: async () => {
      const home = app.getPath('home')
      const res = await dialog.showOpenDialog({
        title: 'Choose where recordings are saved',
        defaultPath: resolveRecordDir(),
        properties: ['openDirectory', 'createDirectory'],
      })
      if (res.canceled || !res.filePaths[0]) return { ok: false }
      const dir = res.filePaths[0]
      const v = validateRecordDir(dir, home)
      if (!v.ok) return { ok: false, error: v.error }
      try {
        await fsPromises.mkdir(dir, { recursive: true })
        await fsPromises.access(dir, fsConstants.W_OK)
      } catch {
        return { ok: false, error: 'that folder is not writable' }
      }
      settings.patch({ recordDir: dir })
      setState({ recording: { ...state.recording, dir, error: null }, settings: viewOf(settings.load()) })
      return { ok: true, dir }
    },

    openRecording: async (path: string) => {
      // openPath launches the system video player; on a machine with none
      // installed it returns a non-empty error string rather than throwing.
      const err = await shell.openPath(path)
      if (!err) return { ok: true }
      console.warn('[record] openPath failed, revealing instead:', err)
      try {
        shell.showItemInFolder(path)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },

    dismissSummary: async () => { setState({ phase: goReadyPhase(), summary: null }) },
```

Add `import { constants as fsConstants } from 'node:fs'` if not already present, and confirm `toast` and `win` are in scope at this point in the file — the diagnostics and plugin-install handlers already use both, so follow whatever names they use.

- [ ] **Step 9: Stop recording on quit**

Beside the existing shutdown wiring (search for `before-quit` or the smoke watcher's shutdown deps), add:

```ts
  app.on('before-quit', () => {
    // Finalize an in-flight recording, but never let quitting hang on OBS.
    if (!state.recording.active) return
    void Promise.race([
      recorder.stopRecording(),
      new Promise((r) => setTimeout(r, 2000)),
    ]).catch(() => {})
  })
```

- [ ] **Step 10: Typecheck and run the suite**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: clean.

Run: `npm -w @axistream/app run test`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add packages/app/src/main/index.ts
git commit -m "feat(main): wire recording lifecycle and end-of-stream summary"
```

---

### Task 7: Record button

**Files:**
- Create: `packages/app/src/renderer/components/RecordButton.tsx`
- Test: `packages/app/test/record-button.test.tsx`

**Interfaces:**
- Consumes: `RecordingState`, `AxiApi`.
- Produces: `RecordButton({ recording, disabled, axi }: { recording: RecordingState; disabled: boolean; axi: AxiApi })`.

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/record-button.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RecordButton } from '../src/renderer/components/RecordButton.js'
import type { RecordingState } from '../src/shared/state.js'

const idle: RecordingState = { active: false, startedAt: null, dir: '/home/u/Videos/AxiStream', lastPath: null, error: null }

const api = (over: Record<string, any> = {}) => ({
  startRecording: vi.fn(async () => ({ ok: true })),
  stopRecording: vi.fn(async () => ({ ok: true, outputPath: '/home/u/v.mp4' })),
  openRecording: vi.fn(async () => ({ ok: true })),
  ...over,
}) as any

describe('RecordButton', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('starts a recording when idle', () => {
    const axi = api()
    render(<RecordButton recording={idle} disabled={false} axi={axi} />)

    fireEvent.click(screen.getByRole('button', { name: /record/i }))

    expect(axi.startRecording).toHaveBeenCalled()
  })

  it('shows elapsed time derived from startedAt while active', () => {
    vi.setSystemTime(new Date('2026-08-24T12:05:30Z'))
    const active: RecordingState = { ...idle, active: true, startedAt: new Date('2026-08-24T12:00:00Z').getTime() }

    render(<RecordButton recording={active} disabled={false} axi={api()} />)

    expect(screen.getByText('5:30')).toBeTruthy()
  })

  it('stops the recording when active', () => {
    const axi = api()
    const active: RecordingState = { ...idle, active: true, startedAt: Date.now() }
    render(<RecordButton recording={active} disabled={false} axi={axi} />)

    fireEvent.click(screen.getByRole('button', { name: /stop recording/i }))

    expect(axi.stopRecording).toHaveBeenCalled()
  })

  it('is disabled with an explanation when an audio test is running', () => {
    render(<RecordButton recording={idle} disabled axi={api()} />)

    const btn = screen.getByRole('button', { name: /record/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.title).toMatch(/audio test/i)
  })

  it('offers to open the last recording once one has finished', () => {
    const axi = api()
    render(<RecordButton recording={{ ...idle, lastPath: '/home/u/v.mp4' }} disabled={false} axi={axi} />)

    fireEvent.click(screen.getByRole('button', { name: /open recording/i }))

    expect(axi.openRecording).toHaveBeenCalledWith('/home/u/v.mp4')
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm -w @axistream/app run test -- record-button`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/app/src/renderer/components/RecordButton.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Circle, Square, FolderOpen } from 'lucide-react'
import type { AxiApi, RecordingState } from '../../shared/state.js'

/** m:ss, or h:mm:ss past an hour — a three-hour session should not read 183:04. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export function RecordButton({ recording, disabled, axi }: { recording: RecordingState; disabled: boolean; axi: AxiApi }) {
  // Elapsed time is derived here rather than pushed from main: a per-second
  // counter over IPC would be a second stats channel carrying one number.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!recording.active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [recording.active])

  if (recording.active) {
    const elapsed = formatElapsed(now - (recording.startedAt ?? now))
    return (
      <button className="btn danger sm" onClick={() => void axi.stopRecording()} title="Stop the local recording">
        <Square size={13} /> Stop recording <span className="mono rec-elapsed">{elapsed}</span>
      </button>
    )
  }

  return (
    <>
      <button className="btn ghost sm" disabled={disabled} onClick={() => void axi.startRecording()}
        title={disabled ? 'Not while an audio test is running' : 'Save a local copy of what you are capturing'}>
        <Circle size={13} /> Record
      </button>
      {recording.lastPath ? (
        <button className="btn ghost xs" onClick={() => void axi.openRecording(recording.lastPath as string)}
          title={recording.lastPath}>
          <FolderOpen size={12} /> Open recording
        </button>
      ) : null}
    </>
  )
}
```

The elapsed test sets a fake system time and expects a first render at `5:30`, so the initial `useState` must read `Date.now()` rather than starting at zero.

- [ ] **Step 4: Run the tests**

Run: `npm -w @axistream/app run test -- record-button`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/renderer/components/RecordButton.tsx packages/app/test/record-button.test.tsx
git commit -m "feat(ui): record button with derived elapsed time"
```

---

### Task 8: Stream summary panel

**Files:**
- Create: `packages/app/src/renderer/components/StreamSummaryPanel.tsx`
- Test: `packages/app/test/stream-summary-panel.test.tsx`

**Interfaces:**
- Consumes: `StreamSummary`, `AxiApi`, `formatElapsed` from `./RecordButton.js`.
- Produces: `StreamSummaryPanel({ summary, axi }: { summary: StreamSummary; axi: AxiApi })`, `droppedVerdict(pct: number): string`.

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/stream-summary-panel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StreamSummaryPanel, droppedVerdict } from '../src/renderer/components/StreamSummaryPanel.js'
import type { StreamSummary } from '../src/shared/state.js'

const base: StreamSummary = {
  durationMs: 5_400_000, avgBitrateKbps: 6000, peakDroppedPct: 0.02, droppedFrames: 12,
  droppedPct: 0.02, encoder: 'NVENC H.264', watchUrl: null,
  recordingPath: null, recordingStillActive: false, endedWithError: false,
}

const api = (over: Record<string, any> = {}) => ({
  copyToClipboard: vi.fn(async () => true),
  openRecording: vi.fn(async () => ({ ok: true })),
  stopRecording: vi.fn(async () => ({ ok: true, outputPath: '/home/u/v.mp4' })),
  dismissSummary: vi.fn(async () => {}),
  ...over,
}) as any

describe('droppedVerdict', () => {
  it('calls a clean stream clean', () => {
    expect(droppedVerdict(0.02)).toMatch(/clean/i)
  })

  it('warns when viewers would have seen it', () => {
    expect(droppedVerdict(3.1)).toMatch(/stuttering/i)
  })
})

describe('StreamSummaryPanel', () => {
  it('reports duration and average bitrate', () => {
    render(<StreamSummaryPanel summary={base} axi={api()} />)

    expect(screen.getByText('1:30:00')).toBeTruthy()
    expect(screen.getByText(/6000 kbps/i)).toBeTruthy()
  })

  it('omits the watch link entirely when there is no watch url', () => {
    render(<StreamSummaryPanel summary={base} axi={api()} />)

    expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull()
  })

  it('copies the watch link through the main-process clipboard', () => {
    const axi = api()
    render(<StreamSummaryPanel summary={{ ...base, watchUrl: 'https://youtu.be/abc' }} axi={axi} />)

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))

    expect(axi.copyToClipboard).toHaveBeenCalledWith('https://youtu.be/abc')
  })

  it('omits the recording block when no recording happened', () => {
    render(<StreamSummaryPanel summary={base} axi={api()} />)

    expect(screen.queryByRole('button', { name: /open recording/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /stop recording/i })).toBeNull()
  })

  it('opens a recording that finished during the stream', () => {
    const axi = api()
    render(<StreamSummaryPanel summary={{ ...base, recordingPath: '/home/u/v.mp4' }} axi={axi} />)

    fireEvent.click(screen.getByRole('button', { name: /open recording/i }))

    expect(axi.openRecording).toHaveBeenCalledWith('/home/u/v.mp4')
  })

  it('offers to stop a recording still running at stream end', () => {
    const axi = api()
    render(<StreamSummaryPanel summary={{ ...base, recordingStillActive: true }} axi={axi} />)

    expect(screen.getByText(/still recording/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /stop recording/i }))

    expect(axi.stopRecording).toHaveBeenCalled()
  })

  it('dismisses', () => {
    const axi = api()
    render(<StreamSummaryPanel summary={base} axi={axi} />)

    fireEvent.click(screen.getByRole('button', { name: /done/i }))

    expect(axi.dismissSummary).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm -w @axistream/app run test -- stream-summary-panel`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/app/src/renderer/components/StreamSummaryPanel.tsx`:

```tsx
import { useState } from 'react'
import { Link, Check, ExternalLink, FolderOpen, Square } from 'lucide-react'
import type { AxiApi, StreamSummary } from '../../shared/state.js'
import { formatElapsed } from './RecordButton.js'

/** A bare percentage means nothing to someone who has never read an OBS log.
 *  Same principle as the health chips: state the number, then say what it meant. */
export function droppedVerdict(pct: number): string {
  if (pct < 0.5) return 'clean'
  if (pct < 2) return 'a few frames lost'
  return 'viewers likely saw stuttering'
}

export function StreamSummaryPanel({ summary, axi }: { summary: StreamSummary; axi: AxiApi }) {
  const [copied, setCopied] = useState(false)
  const copyLink = async () => {
    if (!summary.watchUrl) return
    // Main-process clipboard: navigator.clipboard fails silently here.
    if (!await axi.copyToClipboard(summary.watchUrl)) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="hero summary-panel" role="region" aria-label="Stream summary">
      <h2>Stream ended</h2>

      <div className="summary-stats">
        <div className="summary-stat">
          <span className="summary-label">Duration</span>
          <span className="summary-value mono">{formatElapsed(summary.durationMs)}</span>
        </div>
        <div className="summary-stat">
          <span className="summary-label">Average bitrate</span>
          <span className="summary-value mono">{summary.avgBitrateKbps} kbps</span>
        </div>
        <div className="summary-stat">
          <span className="summary-label">Dropped frames</span>
          <span className="summary-value mono">
            {summary.droppedPct.toFixed(2)}% — {droppedVerdict(summary.peakDroppedPct)}
          </span>
        </div>
      </div>

      {summary.watchUrl ? (
        <div className="summary-actions">
          <button className="btn ghost sm" onClick={copyLink} title="Copy the YouTube watch link">
            {copied ? <><Check size={14} /> Copied!</> : <><Link size={14} /> Copy link</>}
          </button>
          <a className="btn ghost sm" href={summary.watchUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> Open on YouTube
          </a>
        </div>
      ) : null}

      {summary.recordingStillActive ? (
        <div className="summary-actions">
          <span className="muted">Still recording — the stream ended but the recording did not.</span>
          <button className="btn danger sm" onClick={() => void axi.stopRecording()}>
            <Square size={13} /> Stop recording
          </button>
        </div>
      ) : summary.recordingPath ? (
        <div className="summary-actions">
          <button className="btn ghost sm" onClick={() => void axi.openRecording(summary.recordingPath as string)}>
            <FolderOpen size={14} /> Open recording
          </button>
          {/* Selectable so a failed open still leaves something to copy. */}
          <span className="mono summary-path">{summary.recordingPath}</span>
        </div>
      ) : null}

      <button className="btn primary action" onClick={() => void axi.dismissSummary()}>Done</button>
    </div>
  )
}
```

The verdict reads `peakDroppedPct` while the figure reads `droppedPct`: a spike that recovered still warrants the warning, but the number shown is the session total.

- [ ] **Step 4: Run the tests**

Run: `npm -w @axistream/app run test -- stream-summary-panel`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add the styles**

In `packages/app/src/renderer/styles.css` (or whichever stylesheet the other `hero` classes live in — grep for `.hero-bottom` to find it), append:

```css
.summary-panel { gap: 18px; }
.summary-stats { display: flex; gap: 28px; flex-wrap: wrap; justify-content: center; }
.summary-stat { display: flex; flex-direction: column; gap: 4px; align-items: center; }
.summary-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #94a3b8; }
.summary-value { font-size: 15px; }
.summary-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center; }
.summary-path { font-size: 11px; color: #94a3b8; user-select: text; }
.rec-elapsed { margin-left: 6px; }
```

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/components/StreamSummaryPanel.tsx packages/app/test/stream-summary-panel.test.tsx packages/app/src/renderer/styles.css
git commit -m "feat(ui): end-of-stream summary panel"
```

---

### Task 9: Mount the UI

**Files:**
- Modify: `packages/app/src/renderer/components/StreamScreen.tsx`
- Create: `packages/app/src/renderer/components/RecordingSettings.tsx`
- Modify: `packages/app/src/renderer/components/SettingsScreen.tsx`

**Interfaces:**
- Consumes: `RecordButton`, `StreamSummaryPanel` from Tasks 7–8.
- Produces: no new exported API beyond `RecordingSettings`.

- [ ] **Step 1: Render the summary in `StreamScreen`**

Add the imports:

```tsx
import { RecordButton } from './RecordButton.js'
import { StreamSummaryPanel } from './StreamSummaryPanel.js'
```

Immediately after the `setupPhase` early-return block and before the final `return (`, add:

```tsx
  if (phase === 'ENDED' && state.summary) {
    return <StreamSummaryPanel summary={state.summary} axi={axi} />
  }
```

- [ ] **Step 2: Add the record button to the status row**

In the `statusrow` div, immediately before `<span className="spacer" />`, add:

```tsx
          {capture && phase !== 'AWAITING_APPROVAL'
            ? <RecordButton recording={state.recording} disabled={false} axi={axi} />
            : null}
```

`disabled` is hardcoded false because the audio test lives on the Settings screen and main already rejects a concurrent start with a toast. Wiring an `audioTestInFlight` flag through `AppState` for a case the user cannot reach from this screen would be state for its own sake.

- [ ] **Step 3: Create `RecordingSettings`**

Create `packages/app/src/renderer/components/RecordingSettings.tsx`:

```tsx
import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { AxiApi, RecordingState } from '../../shared/state.js'

export function RecordingSettings({ recording, axi }: { recording: RecordingState; axi: AxiApi }) {
  const [error, setError] = useState<string | null>(null)
  const choose = async () => {
    const r = await axi.chooseRecordDir()
    setError(r.ok || !r.error ? null : r.error)
  }

  return (
    <>
      <h3>Recording</h3>
      <p className="muted">Recordings are saved as MP4 at your stream's quality.</p>
      <p className="mono summary-path">{recording.dir}</p>
      <button className="btn ghost" onClick={() => void choose()}><FolderOpen size={14} /> Change folder</button>
      {/* Stated up front rather than discovered when a recording dies. */}
      <p className="muted">Must be inside your home folder — AxiStream's OBS can't write outside it.</p>
      {error ? <p className="field-err" role="alert">{error}</p> : null}
    </>
  )
}
```

`.field-err` is the unified error class established in sub-project 1 — use it rather than defining another.

- [ ] **Step 4: Mount it in `SettingsScreen`**

Add the import and insert a new section between Quality and Capture:

```tsx
          <section className="setting">
            <RecordingSettings recording={state.recording} axi={axi} />
          </section>
```

- [ ] **Step 5: Typecheck and run the full suite**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Run: `npm -w @axistream/app run test`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/components/
git commit -m "feat(ui): mount record button, summary panel, and recording settings"
```

---

### Task 10: Gates and manual smoke

**Files:** none modified unless a gate fails.

- [ ] **Step 1: Full test suite**

Run: `npm -w @axistream/app run test`
Expected: all pass. The suite stood at 60 files / 479 tests before this work.

- [ ] **Step 2: Capture package suite**

Run: `npm -w @axistream/capture run test`
Expected: pass. Nothing here touches `@axistream/capture`, so a failure means an unrelated regression.

- [ ] **Step 3: Typecheck**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 4: Manual smoke — cannot be automated, needs real OBS**

Run `npm run dev` and check each:

1. **Record without streaming.** Press Record with no stream running. The button becomes "Stop recording" with a counting timer. Stop after ~30s. "Open recording" appears and plays the file.
2. **Default folder.** The file is in `~/Videos/AxiStream/` with a timestamped name.
3. **Change folder.** Settings → Recording → Change folder. Pick a directory under `$HOME`; it sticks across an app restart. Try to pick something outside `$HOME` (`/tmp`, or a mounted drive) — it is rejected inline with the home-folder message, and the old folder remains in effect.
4. **Record while streaming.** Go live, press Record, stream for a minute. Both run; the health chips are unaffected.
5. **Summary with a recording still running.** End the stream without stopping the recording. The summary shows duration, average bitrate, and a dropped-frames verdict; the recording block says "Still recording" with a Stop button. Press it — the block swaps to "Open recording" in place, without dismissing the summary.
6. **Watch link.** With an OAuth go-live, Copy link and Open on YouTube both work from the summary.
7. **Stream-key mode.** Go live with a pasted key. The summary appears with stats but **no** watch-link block.
8. **Crash safety.** Start a recording, then `kill -9` the app. The fragmented mp4 still plays up to the kill point. This is the whole reason for the format choice — verify it.
9. **Audio test still works.** Settings → Test audio, with no recording running. It records 6s and plays back. Then start a recording and try again: it refuses with "not available right now" rather than fighting over OBS's single record output.
10. **Quit while recording.** Start a recording and quit the app. It exits promptly (not hanging on OBS) and the file is playable.

- [ ] **Step 5: Merge**

Announce: "I'm using the finishing-a-development-branch skill to complete this work."

**REQUIRED SUB-SKILL:** superpowers:finishing-a-development-branch.

Per project convention the merge commit is:

```bash
git checkout main
git merge --no-ff feat/recording-vod -m "Merge feat/recording-vod: local recording and end-of-stream summary"
```

**Before merging, run `git status` and confirm no test file is untracked.** Sub-project 2 nearly lost `diagnostics.test.ts` to exactly this — a new test file that was written, passing, and never staged.
