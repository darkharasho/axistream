# GW2 Encoder Presets + Software Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure OBS's Simple-output encoder and bitrate to opinionated, resolution-aware GW2/YouTube presets — hardware (NVENC/VAAPI) when present, x264 otherwise — with a one-shot automatic software-fallback retry when a hardware go-live fails.

**Architecture:** Three new OBS-facing units in `packages/capture` (pure preset table, hardware detection with injectable fs, profile-parameter writer), plus app-side wiring: `StreamSettings.preferSoftware` persistence, `StreamController` gains an `encoderLabel` stats source and an `onStartFailure` retry hook, and `index.ts` applies the preset after every `applyResolution`. Spec: `docs/superpowers/specs/2026-07-06-encoder-presets-design.md`.

**Tech Stack:** TypeScript 5.5, Vitest 2, obs-websocket-js 5 via existing sidecar client, Node `node:fs` probes.

## Global Constraints

- No new dependencies.
- Code style: 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on relative imports (ESM/NodeNext).
- All OBS calls best-effort; encoder configuration must never block go-live or boot. Worst case = today's behavior (OBS profile defaults).
- Simple-mode ini values (exact): nvenc → `'nvenc'`, vaapi → `'ffmpeg_vaapi'`, x264 → `'x264'`. Profile parameters written (exact category/name): `Output`/`Mode` = `'Simple'`, `SimpleOutput`/`StreamEncoder`, `SimpleOutput`/`VBitrate`, `SimpleOutput`/`ABitrate` (numeric values as strings).
- Bitrate table (kbps; "high fps" = fps ≥ 50): height ≥ 1440 → 24000 high / 13000 low; ≥ 1080 → 9000/6000; ≥ 720 → 6000/4000; below → 2500/2500. Audio always 160.
- Labels (exact): `'NVENC'`, `'VAAPI'`, `'x264'`.
- The retry path must NOT run `hooks.onStop` (it completes the YouTube broadcast); `onStop` fires only on terminal failure or a real stop. Retry only when the stream never became live, at most once per `goLive`.
- Test commands: capture → `npm -w @axistream/capture run test`; app → `npm -w @axistream/app run test`. Typecheck gate (Task 6): `cd packages/app && npx tsc --noEmit -p tsconfig.json` → zero errors.

---

## File Structure

**New (capture pkg):** `src/encoder-presets.ts`, `src/detect-encoders.ts`, `src/apply-encoder-settings.ts` (+ matching `test/*.test.ts`); all exported from `src/index.ts` (Task 3).
**Modified (app):** `src/main/StreamSettings.ts` (Task 4), `src/main/StreamController.ts` (Task 5), `src/main/index.ts` (Task 6).

---

### Task 1: encoder-presets (pure preset table)

**Files:**
- Create: `packages/capture/src/encoder-presets.ts`
- Test: `packages/capture/test/encoder-presets.test.ts`

**Interfaces:**
- Produces: `type EncoderKind = 'nvenc' | 'vaapi' | 'x264'`; `interface EncoderPreset { streamEncoder: string; videoBitrateKbps: number; audioBitrateKbps: number; label: string }`; `choosePreset(kind: EncoderKind, outputHeight: number, fps: number): EncoderPreset`.

- [ ] **Step 1: Write the failing test** — `packages/capture/test/encoder-presets.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { choosePreset } from '../src/encoder-presets.js'

describe('choosePreset', () => {
  it('maps encoder kinds to simple-mode ini values and labels', () => {
    expect(choosePreset('nvenc', 1080, 60)).toMatchObject({ streamEncoder: 'nvenc', label: 'NVENC' })
    expect(choosePreset('vaapi', 1080, 60)).toMatchObject({ streamEncoder: 'ffmpeg_vaapi', label: 'VAAPI' })
    expect(choosePreset('x264', 1080, 60)).toMatchObject({ streamEncoder: 'x264', label: 'x264' })
  })

  it('picks bitrate from the height/fps table', () => {
    expect(choosePreset('x264', 1440, 60).videoBitrateKbps).toBe(24000)
    expect(choosePreset('x264', 1440, 30).videoBitrateKbps).toBe(13000)
    expect(choosePreset('x264', 1080, 50).videoBitrateKbps).toBe(9000)
    expect(choosePreset('x264', 1080, 30).videoBitrateKbps).toBe(6000)
    expect(choosePreset('x264', 720, 60).videoBitrateKbps).toBe(6000)
    expect(choosePreset('x264', 720, 49).videoBitrateKbps).toBe(4000)
    expect(choosePreset('x264', 480, 60).videoBitrateKbps).toBe(2500)
    expect(choosePreset('x264', 480, 30).videoBitrateKbps).toBe(2500)
  })

  it('taller-than-1440 canvases use the 1440 tier', () => {
    expect(choosePreset('nvenc', 2160, 60).videoBitrateKbps).toBe(24000)
  })

  it('audio is always 160 kbps', () => {
    expect(choosePreset('nvenc', 1440, 60).audioBitrateKbps).toBe(160)
    expect(choosePreset('x264', 480, 30).audioBitrateKbps).toBe(160)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/capture run test -- test/encoder-presets.test.ts` → FAIL (module missing)
- [ ] **Step 3: Implement** — `packages/capture/src/encoder-presets.ts`:

```ts
export type EncoderKind = 'nvenc' | 'vaapi' | 'x264'

export interface EncoderPreset {
  streamEncoder: string    // SimpleOutput/StreamEncoder ini value
  videoBitrateKbps: number
  audioBitrateKbps: number
  label: string            // shown in the stats chip
}

const ENCODERS: Record<EncoderKind, { streamEncoder: string; label: string }> = {
  nvenc: { streamEncoder: 'nvenc', label: 'NVENC' },
  vaapi: { streamEncoder: 'ffmpeg_vaapi', label: 'VAAPI' },
  x264: { streamEncoder: 'x264', label: 'x264' },
}

/** YouTube-recommended upper range — GW2 is high-motion. "High fps" = ≥ 50. */
function videoBitrate(outputHeight: number, fps: number): number {
  const high = fps >= 50
  if (outputHeight >= 1440) return high ? 24000 : 13000
  if (outputHeight >= 1080) return high ? 9000 : 6000
  if (outputHeight >= 720) return high ? 6000 : 4000
  return 2500
}

export function choosePreset(kind: EncoderKind, outputHeight: number, fps: number): EncoderPreset {
  const e = ENCODERS[kind]
  return { ...e, videoBitrateKbps: videoBitrate(outputHeight, fps), audioBitrateKbps: 160 }
}
```

- [ ] **Step 4: Run to verify pass** — same command → 4 passed
- [ ] **Step 5: Commit**

```bash
git add packages/capture/src/encoder-presets.ts packages/capture/test/encoder-presets.test.ts
git commit -m "feat(capture): GW2 encoder/bitrate preset table"
```

---

### Task 2: detect-encoders (hardware probe)

**Files:**
- Create: `packages/capture/src/detect-encoders.ts`
- Test: `packages/capture/test/detect-encoders.test.ts`

**Interfaces:**
- Consumes: `EncoderKind` from `./encoder-presets.js` (Task 1).
- Produces: `interface DetectDeps { platform: NodeJS.Platform; existsSync(p: string): boolean; readdirSync(p: string): string[] }`; `detectEncoder(d: DetectDeps): EncoderKind`.

- [ ] **Step 1: Write the failing test** — `packages/capture/test/detect-encoders.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { detectEncoder } from '../src/detect-encoders.js'

const deps = (over: Partial<Parameters<typeof detectEncoder>[0]> = {}) => ({
  platform: 'linux' as NodeJS.Platform,
  existsSync: () => false,
  readdirSync: () => [] as string[],
  ...over,
})

describe('detectEncoder', () => {
  it('nvidia device node → nvenc', () => {
    expect(detectEncoder(deps({ existsSync: (p) => p === '/dev/nvidiactl' }))).toBe('nvenc')
    expect(detectEncoder(deps({ existsSync: (p) => p === '/dev/nvidia0' }))).toBe('nvenc')
  })

  it('DRI render node without nvidia → vaapi', () => {
    expect(detectEncoder(deps({ readdirSync: () => ['card0', 'renderD128'] }))).toBe('vaapi')
  })

  it('neither → x264', () => {
    expect(detectEncoder(deps())).toBe('x264')
  })

  it('readdir throwing → treated as no DRI', () => {
    expect(detectEncoder(deps({ readdirSync: () => { throw new Error('EACCES') } }))).toBe('x264')
  })

  it('non-linux platforms → x264 for now', () => {
    expect(detectEncoder(deps({ platform: 'win32', existsSync: () => true, readdirSync: () => ['renderD128'] }))).toBe('x264')
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/capture run test -- test/detect-encoders.test.ts` → FAIL (module missing)
- [ ] **Step 3: Implement** — `packages/capture/src/detect-encoders.ts`:

```ts
import type { EncoderKind } from './encoder-presets.js'

export interface DetectDeps {
  platform: NodeJS.Platform
  existsSync(p: string): boolean
  readdirSync(p: string): string[]
}

/** Cheap hardware hint — OBS's own encoder-availability check is the
 *  authority (an unavailable SimpleOutput encoder falls back to x264 inside
 *  OBS), so a false positive costs nothing worse than that fallback. */
export function detectEncoder(d: DetectDeps): EncoderKind {
  if (d.platform !== 'linux') return 'x264'
  if (d.existsSync('/dev/nvidiactl') || d.existsSync('/dev/nvidia0')) return 'nvenc'
  try {
    if (d.readdirSync('/dev/dri').some((n) => n.startsWith('renderD'))) return 'vaapi'
  } catch { /* no DRI access */ }
  return 'x264'
}
```

- [ ] **Step 4: Run to verify pass** — same command → 5 passed
- [ ] **Step 5: Commit**

```bash
git add packages/capture/src/detect-encoders.ts packages/capture/test/detect-encoders.test.ts
git commit -m "feat(capture): hardware encoder detection heuristic"
```

---

### Task 3: apply-encoder-settings + package exports

**Files:**
- Create: `packages/capture/src/apply-encoder-settings.ts`
- Modify: `packages/capture/src/index.ts`
- Test: `packages/capture/test/apply-encoder-settings.test.ts`

**Interfaces:**
- Consumes: `EncoderPreset` (Task 1); `callReady` from `./call-ready.js` (exists: `callReady<T>(fn, opts?: { tries?: number; delayMs?: number })`, defaults 25×800ms).
- Produces: `interface ApplyEncoderDeps { call: (req: string, params?: object) => Promise<unknown>; tries?: number; delayMs?: number }`; `applyEncoderSettings(deps: ApplyEncoderDeps, preset: EncoderPreset): Promise<boolean>`. Also: Tasks 1–3 exports available from `@axistream/capture`.

- [ ] **Step 1: Write the failing test** — `packages/capture/test/apply-encoder-settings.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { applyEncoderSettings } from '../src/apply-encoder-settings.js'
import { choosePreset } from '../src/encoder-presets.js'

describe('applyEncoderSettings', () => {
  it('writes mode, encoder, and bitrates as profile parameters', async () => {
    const calls: any[] = []
    const call = vi.fn(async (req: string, params?: object) => { calls.push({ req, params }) })
    const ok = await applyEncoderSettings({ call }, choosePreset('nvenc', 1440, 60))
    expect(ok).toBe(true)
    expect(calls).toEqual([
      { req: 'SetProfileParameter', params: { parameterCategory: 'Output', parameterName: 'Mode', parameterValue: 'Simple' } },
      { req: 'SetProfileParameter', params: { parameterCategory: 'SimpleOutput', parameterName: 'StreamEncoder', parameterValue: 'nvenc' } },
      { req: 'SetProfileParameter', params: { parameterCategory: 'SimpleOutput', parameterName: 'VBitrate', parameterValue: '24000' } },
      { req: 'SetProfileParameter', params: { parameterCategory: 'SimpleOutput', parameterName: 'ABitrate', parameterValue: '160' } },
    ])
  })

  it('returns false (never throws) when calls keep failing', async () => {
    const call = vi.fn(async () => { throw new Error('code 600') })
    const ok = await applyEncoderSettings({ call, tries: 2, delayMs: 1 }, choosePreset('x264', 1080, 60))
    expect(ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/capture run test -- test/apply-encoder-settings.test.ts` → FAIL (module missing)
- [ ] **Step 3: Implement** — `packages/capture/src/apply-encoder-settings.ts`:

```ts
import { callReady } from './call-ready.js'
import type { EncoderPreset } from './encoder-presets.js'

export interface ApplyEncoderDeps {
  call: (req: string, params?: object) => Promise<unknown>
  // Retry bounds (OBS rejects profile requests with code 600 briefly after
  // startup). Defaults match callReady; tests pass small values.
  tries?: number
  delayMs?: number
}

/** Write the preset into the AxiStream profile's Simple output settings.
 *  Takes effect at the next StartStream. Best-effort: returns false on
 *  failure and never throws — go-live proceeds on whatever the profile holds. */
export async function applyEncoderSettings(deps: ApplyEncoderDeps, preset: EncoderPreset): Promise<boolean> {
  const ready = <T>(fn: () => Promise<T>) => callReady(fn, { tries: deps.tries, delayMs: deps.delayMs })
  const set = (parameterCategory: string, parameterName: string, parameterValue: string) =>
    ready(() => deps.call('SetProfileParameter', { parameterCategory, parameterName, parameterValue }))
  try {
    await set('Output', 'Mode', 'Simple')
    await set('SimpleOutput', 'StreamEncoder', preset.streamEncoder)
    await set('SimpleOutput', 'VBitrate', String(preset.videoBitrateKbps))
    await set('SimpleOutput', 'ABitrate', String(preset.audioBitrateKbps))
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Export** — append to `packages/capture/src/index.ts`:

```ts
export * from './encoder-presets.js'
export * from './detect-encoders.js'
export * from './apply-encoder-settings.js'
```

- [ ] **Step 5: Run capture suite** — `npm -w @axistream/capture run test` → all pass (56 = 47 existing + 9 new... counts may differ; all green)
- [ ] **Step 6: Commit**

```bash
git add packages/capture/src/apply-encoder-settings.ts packages/capture/test/apply-encoder-settings.test.ts packages/capture/src/index.ts
git commit -m "feat(capture): apply encoder preset via profile parameters"
```

---

### Task 4: StreamSettings.preferSoftware

**Files:**
- Modify: `packages/app/src/main/StreamSettings.ts`
- Test: `packages/app/test/stream-settings.test.ts` (append)

**Interfaces:**
- Produces: `StreamSettingsData.preferSoftware: boolean` (default `false`), boolean-validated in `load()` like `desktopEnabled`.

- [ ] **Step 1: Write the failing tests** — append to `packages/app/test/stream-settings.test.ts` (reuse the file's existing temp-path pattern):

```ts
describe('preferSoftware', () => {
  it('defaults to false and round-trips', () => {
    const s = new StreamSettings(file)
    expect(s.load().preferSoftware).toBe(false)
    s.patch({ preferSoftware: true })
    expect(s.load().preferSoftware).toBe(true)
  })

  it('non-boolean value falls back to false', () => {
    writeFileSync(file, JSON.stringify({ preferSoftware: 'yes' }))
    const s = new StreamSettings(file)
    expect(s.load().preferSoftware).toBe(false)
  })
})
```

(Adapt `file`/setup names to what the test file actually uses.)

- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/app run test -- test/stream-settings.test.ts` → FAIL
- [ ] **Step 3: Implement** — in `StreamSettings.ts`: add `preferSoftware: boolean` to `StreamSettingsData`; `preferSoftware: false` to `DEFAULT_SETTINGS`; in `load()`'s return add `preferSoftware: typeof raw.preferSoftware === 'boolean' ? raw.preferSoftware : DEFAULT_SETTINGS.preferSoftware,`
- [ ] **Step 4: Run to verify pass** — same command → all pass
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/StreamSettings.ts packages/app/test/stream-settings.test.ts
git commit -m "feat(settings): persist preferSoftware encoder flag"
```

---

### Task 5: StreamController — encoder label + one-shot fallback retry

**Files:**
- Modify: `packages/app/src/main/StreamController.ts`
- Test: `packages/app/test/stream-controller.test.ts` (append)

**Interfaces:**
- Produces: `StreamDeps.encoderLabel?: () => string` (stats use it; default `'x264'`); `StreamDeps.onStartFailure?: () => Promise<boolean>` (called at most once per `goLive`, only when the stream never became live; true → silent restart, false/throw → normal ERROR path). Existing public API unchanged.

- [ ] **Step 1: Write the failing tests** — append inside the existing `describe('StreamController', ...)` in `packages/app/test/stream-controller.test.ts` (matches the file's real-timer style):

```ts
  it('stats report the injected encoder label', async () => {
    const c = clientFrom([{ outputActive: true, outputReconnecting: false, outputBytes: 1 }])
    const stats: any[] = []
    const sc = new StreamController({ client: c.client, onPhase: () => {}, onStats: (s) => stats.push(s), pollMs: 5, encoderLabel: () => 'NVENC' })
    await sc.goLive(ingest)
    await new Promise((r) => setTimeout(r, 30))
    await sc.stop()
    expect(stats.length).toBeGreaterThan(0)
    expect(stats.every((s) => s.encoder === 'NVENC')).toBe(true)
  })

  it('retries once via onStartFailure without running onStop, then goes LIVE', async () => {
    // Never active until after the retry's StartStream, then active.
    let started = 0
    const calls: string[] = []
    const client = () => ({
      call: vi.fn(async (req: string) => {
        calls.push(req)
        if (req === 'StartStream') started++
        if (req === 'GetStreamStatus') return { outputActive: started >= 2, outputReconnecting: false, outputBytes: 1 }
        return {}
      }),
    })
    const phases: string[] = []
    let stopped = false
    let fallbacks = 0
    const sc = new StreamController({
      client, onPhase: (p) => phases.push(p), onStats: () => {}, pollMs: 5, goLiveTimeoutMs: 15,
      onStartFailure: async () => { fallbacks++; return true },
    })
    await sc.goLive(ingest, { onStop: async () => { stopped = true } })
    await new Promise((r) => setTimeout(r, 120))
    expect(fallbacks).toBe(1)
    expect(started).toBe(2)
    expect(phases).toContain('LIVE')
    expect(phases).not.toContain('ERROR')
    expect(stopped).toBe(false) // onStop must NOT fire on the retry path
    await sc.stop()
  })

  it('reports ERROR (and runs onStop) when the retry also fails', async () => {
    const c = clientFrom([{ outputActive: false, outputReconnecting: false, outputBytes: 0 }])
    const phases: string[] = []
    let stopped = false
    let fallbacks = 0
    const sc = new StreamController({
      client: c.client, onPhase: (p) => phases.push(p), onStats: () => {}, pollMs: 5, goLiveTimeoutMs: 15,
      onStartFailure: async () => { fallbacks++; return true },
    })
    await sc.goLive(ingest, { onStop: async () => { stopped = true } })
    await new Promise((r) => setTimeout(r, 200))
    expect(fallbacks).toBe(1) // once per goLive, not once per failure
    expect(phases).toContain('ERROR')
    expect(stopped).toBe(true)
  })

  it('onStartFailure throwing falls through to ERROR', async () => {
    const c = clientFrom([{ outputActive: false, outputReconnecting: false, outputBytes: 0 }])
    const phases: string[] = []
    const sc = new StreamController({
      client: c.client, onPhase: (p) => phases.push(p), onStats: () => {}, pollMs: 5, goLiveTimeoutMs: 15,
      onStartFailure: async () => { throw new Error('apply failed') },
    })
    await sc.goLive(ingest)
    await new Promise((r) => setTimeout(r, 90))
    expect(phases).toContain('ERROR')
  })
```

- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/app run test -- test/stream-controller.test.ts` → new tests FAIL (label is x264; no retry)
- [ ] **Step 3: Implement** — restructure `StreamController.ts`:

Add to `StreamDeps`:

```ts
  encoderLabel?: () => string
  onStartFailure?: () => Promise<boolean>
```

Add a `private retried = false` field. Split the start sequence out of `goLive` so the retry can re-run it:

```ts
  async goLive(target: Ingest, hooks: GoLiveHooks = {}): Promise<void> {
    if (this.live || this.timer) return
    this.hooks = hooks
    this.retried = false
    await this.start(target)
  }

  private async start(target: Ingest): Promise<void> {
    const c = this.d.client()
    await callReady(() => c.call('SetStreamServiceSettings', {
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: { server: target.server, key: target.key },
    }))
    await callReady(() => c.call('StartStream'))
    this.d.onPhase('GOING_LIVE')
    this.lastBytes = 0
    this.firstSample = true
    const pollMs = this.d.pollMs ?? 1000
    const deadline = (this.d.goLiveTimeoutMs ?? 15000) / pollMs
    let ticks = 0
    let becameLive = false
    this.timer = setInterval(async () => {
      ticks++
      let st: any
      try { st = await c.call('GetStreamStatus') } catch { return }
      if (!st.outputActive && !becameLive) {
        if (ticks >= deadline) await this.failStart(c, target, true)
        return
      }
      if (st.outputActive && !becameLive) {
        becameLive = true
        try { await this.hooks.onIngestActive?.() }
        catch { await this.failStart(c, target, false); return }
        this.live = true
        this.d.onPhase('LIVE')
      }
      this.d.onPhase(st.outputReconnecting ? 'RECONNECTING' : 'LIVE')
      this.d.onStats(this.mapStats(st, pollMs))
    }, pollMs)
  }
```

`failStart` gains the retry seam. `canRetry` is false on the ingest-active
failure path (the push worked — a different encoder won't fix broadcast
confirmation) and true on the never-active timeout:

```ts
  private async failStart(c: { call(r: string): Promise<any> }, target: Ingest, canRetry: boolean): Promise<void> {
    this.clear()
    try { await c.call('StopStream') } catch { /* ignore */ }
    if (canRetry && !this.retried && this.d.onStartFailure) {
      this.retried = true
      let retry = false
      try { retry = await this.d.onStartFailure() } catch { /* treated as no-retry */ }
      // Retry restarts the push without touching hooks.onStop — onStop
      // completes the YouTube broadcast, which would kill the session the
      // retry is trying to save.
      if (retry) { await this.start(target); return }
    }
    try { await this.hooks.onStop?.() } catch { /* ignore */ }
    this.live = false
    this.d.onPhase('ERROR', "Couldn't start stream — check your key and connection.")
  }
```

In `mapStats`, compute the label once and use it in both return objects
(replacing the two hardcoded `'x264'` literals):

```ts
    const encoder = this.d.encoderLabel?.() ?? 'x264'
```

- [ ] **Step 4: Run to verify pass** — `npm -w @axistream/app run test -- test/stream-controller.test.ts` → all pass (3 existing + 4 new)
- [ ] **Step 5: Full app suite** — `npm -w @axistream/app run test` → all pass
- [ ] **Step 6: Commit**

```bash
git add packages/app/src/main/StreamController.ts packages/app/test/stream-controller.test.ts
git commit -m "feat(stream): encoder label in stats + one-shot software-fallback retry"
```

---

### Task 6: Main-process wiring

**Files:**
- Modify: `packages/app/src/main/index.ts`
- Test: whole suites + typecheck (index.ts has no unit harness; its seams are tested in Tasks 1–5)

**Interfaces:**
- Consumes: `detectEncoder`, `choosePreset`, `applyEncoderSettings`, `type EncoderKind`, `type EncoderPreset` from `@axistream/capture` (Task 3 exports); `settings.load().preferSoftware` / `settings.patch({ preferSoftware: true })` (Task 4); `StreamDeps.encoderLabel` / `onStartFailure` (Task 5).

- [ ] **Step 1: Wire it.** In `packages/app/src/main/index.ts`:
  - Extend the `@axistream/capture` import with `detectEncoder, choosePreset, applyEncoderSettings, type EncoderKind, type EncoderPreset`; extend the `node:fs` import with `readdirSync` (`existsSync` is already imported).
  - After `const audio = new AudioController(...)` / `const maskCtl = ...` block, add:

```ts
  let encoderKind: EncoderKind = settings.load().preferSoftware
    ? 'x264'
    : detectEncoder({ platform: process.platform, existsSync, readdirSync })
  let currentPreset: EncoderPreset | null = null
  const applyEncoderPreset = async (outputHeight: number, fps: number): Promise<boolean> => {
    currentPreset = choosePreset(encoderKind, outputHeight, fps)
    return applyEncoderSettings({ call: (r, p) => sidecar.client().call(r as never, p as never) }, currentPreset)
  }
```

  - Add to the `new StreamController({ ... })` deps:

```ts
    encoderLabel: () => currentPreset?.label ?? 'x264',
    onStartFailure: async () => {
      if (encoderKind === 'x264') return false
      encoderKind = 'x264'
      settings.patch({ preferSoftware: true })
      return applyEncoderPreset(state.capture?.outputHeight ?? 1080, state.capture?.fps ?? 60)
    },
```

  - After every `const capture_ = await applyResolution()` (four sites: `provision`, `repairCapture`, `switchSource` handlers, and the provisioned boot branch), add:

```ts
      await applyEncoderPreset(capture_.outputHeight, capture_.fps)
```

- [ ] **Step 2: Typecheck** — `cd packages/app && npx tsc --noEmit -p tsconfig.json` → zero errors
- [ ] **Step 3: Full suites** — `npm -w @axistream/capture run test && npm -w @axistream/app run test` → all pass
- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main/index.ts
git commit -m "feat(main): detect hardware encoder, apply GW2 preset, wire software fallback"
```

---

## Final verification (whole branch)

- `npm -w @axistream/capture run test` and `npm -w @axistream/app run test` — green.
- `cd packages/app && npx tsc --noEmit -p tsconfig.json` — zero errors.
- Manual smoke (human, NVIDIA box): after boot, the AxiStream profile's `basic.ini` shows `StreamEncoder=nvenc` and the table's `VBitrate` for the monitor; go-live streams hardware-encoded; stats chip reads NVENC.
