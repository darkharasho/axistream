# Stream Audio Check ("Test audio") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Test audio" button that records ~6 s of the real OBS output (same mix/encoders as the stream) and plays it back in-app.

**Architecture:** A pure `RecordController` (injected obs-websocket client + sleep) drives SetProfileParameter×3 → StartRecord → sleep → StopRecord and returns the clip path; a `recordAudioTest` IPC handler guards live phases, reads+deletes the temp clip, and returns the bytes as a Buffer; `AudioSettings.tsx` gains an idle → recording (countdown) → ready (`<audio>` playback) / error block.

**Tech Stack:** Electron 31 main/preload/renderer, React 18, TypeScript 5.5 (ESM/NodeNext), Vitest 2 (fork pool ≤2).

## Global Constraints

- 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on all relative imports.
- OBS calls are best-effort — RecordController never throws out; failures return `{ ok: false, error }`.
- Record profile params (exact values): `SimpleOutput/FilePath` = caller's dir, `SimpleOutput/RecFormat2` = `'fragmented_mp4'`, `SimpleOutput/RecQuality` = `'Stream'`.
- The handler must refuse while `stream.isLive()`, `state.phase === 'GOING_LIVE'`, or `!state.capture`.
- The clip travels over IPC as a `Buffer` (structured clone), NOT base64.
- vitest: `npm -w @axistream/app run test`. Typecheck gate: `cd packages/app && npx tsc --noEmit -p tsconfig.json`.

---

### Task 1: RecordController

**Files:**
- Create: `packages/app/src/main/RecordController.ts`
- Test: `packages/app/test/record-controller.test.ts`

**Interfaces:**
- Consumes: nothing (pure; injected deps).
- Produces:
  - `interface RecordDeps { client(): { call(req: string, data?: unknown): Promise<any> }; sleep?: (ms: number) => Promise<void> }`
  - `interface TestRecordingResult { ok: boolean; outputPath?: string; error?: string }`
  - `class RecordController { constructor(d: RecordDeps); recordTestClip(durationMs: number, dir: string): Promise<TestRecordingResult> }`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/test/record-controller.test.ts
import { describe, it, expect, vi } from 'vitest'
import { RecordController } from '../src/main/RecordController.js'

function harness(overrides: Record<string, any> = {}) {
  const calls: { req: string; data: any }[] = []
  const client = {
    call: vi.fn(async (req: string, data?: any) => {
      calls.push({ req, data })
      if (req in overrides) {
        const v = overrides[req]
        if (v instanceof Error) throw v
        return v
      }
      if (req === 'StopRecord') return { outputPath: '/tmp/clip.mp4' }
      return {}
    }),
  }
  const sleeps: number[] = []
  const ctl = new RecordController({ client: () => client, sleep: async (ms) => { sleeps.push(ms) } })
  return { calls, sleeps, ctl }
}

describe('RecordController.recordTestClip', () => {
  it('sets record params, records for the duration, and returns the clip path', async () => {
    const h = harness()
    const r = await h.ctl.recordTestClip(6000, '/tmp/axitest')
    expect(r).toEqual({ ok: true, outputPath: '/tmp/clip.mp4' })
    const params = h.calls.filter((c) => c.req === 'SetProfileParameter').map((c) => c.data)
    expect(params).toEqual([
      { parameterCategory: 'SimpleOutput', parameterName: 'FilePath', parameterValue: '/tmp/axitest' },
      { parameterCategory: 'SimpleOutput', parameterName: 'RecFormat2', parameterValue: 'fragmented_mp4' },
      { parameterCategory: 'SimpleOutput', parameterName: 'RecQuality', parameterValue: 'Stream' },
    ])
    const order = h.calls.map((c) => c.req)
    expect(order.indexOf('StartRecord')).toBeGreaterThan(order.lastIndexOf('SetProfileParameter'))
    expect(order.indexOf('StopRecord')).toBeGreaterThan(order.indexOf('StartRecord'))
    expect(h.sleeps).toEqual([6000])
  })

  it('a profile-param failure aborts before StartRecord', async () => {
    const h = harness({ SetProfileParameter: new Error('no profile') })
    const r = await h.ctl.recordTestClip(6000, '/tmp/x')
    expect(r.ok).toBe(false)
    expect(h.calls.some((c) => c.req === 'StartRecord')).toBe(false)
  })

  it('a StartRecord failure returns an error and never calls StopRecord', async () => {
    const h = harness({ StartRecord: new Error('output busy') })
    const r = await h.ctl.recordTestClip(6000, '/tmp/x')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('output busy')
    expect(h.calls.some((c) => c.req === 'StopRecord')).toBe(false)
  })

  it('a StopRecord failure is retried once, then errors without throwing', async () => {
    let stops = 0
    const client = {
      call: vi.fn(async (req: string) => {
        if (req === 'StopRecord') { stops++; throw new Error('stop failed') }
        return {}
      }),
    }
    const ctl = new (await import('../src/main/RecordController.js')).RecordController({ client: () => client, sleep: async () => {} })
    const r = await ctl.recordTestClip(6000, '/tmp/x')
    expect(r.ok).toBe(false)
    expect(stops).toBe(2)
  })

  it('missing outputPath in the StopRecord response is an error', async () => {
    const h = harness({ StopRecord: {} })
    const r = await h.ctl.recordTestClip(6000, '/tmp/x')
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm -w @axistream/app run test -- record-controller`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/main/RecordController.ts
export interface RecordDeps {
  client(): { call(req: string, data?: unknown): Promise<any> }
  sleep?: (ms: number) => Promise<void>
}
export interface TestRecordingResult { ok: boolean; outputPath?: string; error?: string }

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Drives one short test recording through OBS's Simple-output recorder.
// RecQuality 'Stream' shares the stream encoders, so the recorded audio path
// is byte-identical to what viewers hear. Best-effort — never throws.
export class RecordController {
  constructor(private readonly d: RecordDeps) {}

  async recordTestClip(durationMs: number, dir: string): Promise<TestRecordingResult> {
    const c = this.d.client()
    const sleep = this.d.sleep ?? defaultSleep
    const set = (parameterName: string, parameterValue: string) =>
      c.call('SetProfileParameter', { parameterCategory: 'SimpleOutput', parameterName, parameterValue })
    try {
      await set('FilePath', dir)
      await set('RecFormat2', 'fragmented_mp4')
      await set('RecQuality', 'Stream')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn('[record] setting record params failed', msg)
      return { ok: false, error: msg }
    }
    try {
      await c.call('StartRecord')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn('[record] StartRecord failed', msg)
      return { ok: false, error: msg }
    }
    await sleep(durationMs)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await c.call('StopRecord') as { outputPath?: string }
        if (!r.outputPath) return { ok: false, error: 'no output path from OBS' }
        return { ok: true, outputPath: r.outputPath }
      } catch (e) {
        if (attempt === 1) {
          const msg = e instanceof Error ? e.message : String(e)
          console.warn('[record] StopRecord failed', msg)
          return { ok: false, error: msg }
        }
      }
    }
    return { ok: false, error: 'unreachable' }
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm -w @axistream/app run test -- record-controller`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/RecordController.ts packages/app/test/record-controller.test.ts
git commit -m "feat(audio-check): RecordController — one-shot OBS test recording"
```

---

### Task 2: IPC plumbing + handler

**Files:**
- Modify: `packages/app/src/shared/state.ts` (CH entry, `AudioTestResult`, AxiApi method)
- Modify: `packages/app/src/main/ipc.ts` (Handlers decl + registration)
- Modify: `packages/app/src/preload/index.ts` (binding)
- Modify: `packages/app/src/main/index.ts` (recorder construction, handler, boot sweep)
- No new test file — verified by tsc + full suite; wiring is review-verified.

**Interfaces:**
- Consumes: `RecordController` from Task 1.
- Produces: `AxiApi.recordAudioTest(): Promise<AudioTestResult>`; `CH.recordAudioTest = 'axi:recordAudioTest'`; `interface AudioTestResult { ok: boolean; clip?: Uint8Array; mime?: string; error?: string }`.

- [ ] **Step 1: Shared type + channel (state.ts)**

Add to `CH` (before `} as const`): `recordAudioTest: 'axi:recordAudioTest',`
Add the shared type and AxiApi method:
```ts
export interface AudioTestResult { ok: boolean; clip?: Uint8Array; mime?: string; error?: string }
```
```ts
  recordAudioTest(): Promise<AudioTestResult>
```

- [ ] **Step 2: ipc.ts + preload**

`ipc.ts` Handlers: `recordAudioTest(): Promise<AudioTestResult>` (import the type from `../shared/state.js`); register: `ipcMain.handle(CH.recordAudioTest, () => handlers.recordAudioTest())`.
Preload: `recordAudioTest: () => ipcRenderer.invoke(CH.recordAudioTest) as Promise<AudioTestResult>,` (match the file's existing type-import style).

- [ ] **Step 3: index.ts wiring**

Import: `import { RecordController } from './RecordController.js'` and add `promises as fsPromises` to the `node:fs` import (line 4) — i.e. `import { readFileSync, writeFileSync, existsSync, readdirSync, openSync, readSync, closeSync, promises as fsPromises } from 'node:fs'`.
Construct next to the other controllers (~line 168): `const recorder = new RecordController({ client: () => sidecar.client() })`.
Handler (near the other audio handlers):
```ts
    recordAudioTest: async () => {
      if (stream.isLive() || state.phase === 'GOING_LIVE' || !state.capture) {
        return { ok: false, error: 'not available right now' }
      }
      const r = await recorder.recordTestClip(6000, app.getPath('temp'))
      if (!r.ok || !r.outputPath) return { ok: false, error: r.error ?? 'recording failed' }
      try {
        const clip = await fsPromises.readFile(r.outputPath)
        await fsPromises.unlink(r.outputPath).catch(() => {})
        return { ok: true, clip, mime: 'video/mp4' }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
```
Boot sweep (inside `app.whenReady`, before the OBS boot — best-effort, silent):
```ts
  // Sweep stale audio-test clips (OBS names them; we only control the dir).
  void (async () => {
    try {
      const dir = app.getPath('temp')
      const dayAgo = Date.now() - 86_400_000
      for (const f of await fsPromises.readdir(dir)) {
        if (!f.endsWith('.mp4')) continue
        const p = join(dir, f)
        const st = await fsPromises.stat(p).catch(() => null)
        if (st && st.mtimeMs < dayAgo) await fsPromises.unlink(p).catch(() => {})
      }
    } catch { /* best-effort */ }
  })()
```

- [ ] **Step 4: Typecheck + full suite**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` — expected: zero errors.
Run: `npm -w @axistream/app run test` — expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/main/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/index.ts
git commit -m "feat(audio-check): recordAudioTest IPC — record, read, return clip buffer"
```

---

### Task 3: AudioSettings UI

**Files:**
- Modify: `packages/app/src/renderer/components/AudioSettings.tsx`
- Modify: `packages/app/src/renderer/styles.css`
- Test: `packages/app/test/audio-settings.test.tsx`

**Interfaces:**
- Consumes: `axi().recordAudioTest()` (Task 2); existing `phase` prop.
- Produces: no new exports.

**Context:** `AudioSettings` already receives `phase: AppState['phase']`. The axi mock in the test file must gain `recordAudioTest`. Component state machine: `idle | recording | ready | error` in a single `useState`. Blob URLs must be revoked when replaced.

- [ ] **Step 1: Write the failing tests**

Add `recordAudioTest: vi.fn(async () => ({ ok: true, clip: new Uint8Array([0]), mime: 'video/mp4' }))` to the axi mock object. Add tests:

```ts
  it('Test audio renders and is disabled while live', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="LIVE" />)
    expect(screen.getByRole('button', { name: /test audio/i })).toBeDisabled()
  })

  it('running a test shows the countdown then a player', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" />)
    fireEvent.click(screen.getByRole('button', { name: /test audio/i }))
    expect(screen.getByText(/speak now/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('audio-test-player')).toBeInTheDocument())
    expect(axi.recordAudioTest).toHaveBeenCalled()
  })

  it('a failed test shows the error and allows retry', async () => {
    axi.recordAudioTest.mockResolvedValueOnce({ ok: false, error: 'output busy' })
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" />)
    fireEvent.click(screen.getByRole('button', { name: /test audio/i }))
    await waitFor(() => expect(screen.getByText(/output busy/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /test audio/i })).not.toBeDisabled()
  })
```

Note for jsdom: `URL.createObjectURL` may be undefined — stub it in the test file's beforeEach: `URL.createObjectURL = URL.createObjectURL ?? (() => 'blob:mock')` (and a no-op `revokeObjectURL`).

- [ ] **Step 2: Run to verify they fail**

Run: `npm -w @axistream/app run test -- audio-settings`
Expected: FAIL — no Test audio button.

- [ ] **Step 3: Implement the UI block**

At the top of the component add:
```ts
  const [test, setTest] = useState<{ st: 'idle' | 'recording' | 'ready' | 'error'; url?: string; error?: string; left?: number }>({ st: 'idle' })
  const canTest = phase === 'READY' || phase === 'NEEDS_KEY' || phase === 'NEEDS_TITLE'

  const runTest = async () => {
    if (test.url) URL.revokeObjectURL(test.url)
    setTest({ st: 'recording', left: 6 })
    const tick = setInterval(() => setTest((t) => (t.st === 'recording' ? { ...t, left: Math.max(0, (t.left ?? 0) - 1) } : t)), 1000)
    const r = await axi().recordAudioTest()
    clearInterval(tick)
    if (r.ok && r.clip) {
      const url = URL.createObjectURL(new Blob([r.clip as BlobPart], { type: r.mime ?? 'video/mp4' }))
      setTest({ st: 'ready', url })
    } else {
      setTest({ st: 'error', error: r.error ?? 'Test failed' })
    }
  }
```
Add at the bottom of the returned JSX (after the mic device block):
```tsx
      <div className="audio-test">
        <button className="btn ghost sm" disabled={!canTest || test.st === 'recording'} onClick={runTest}>
          {test.st === 'recording' ? `Recording — speak now… ${test.left}` : 'Test audio'}
        </button>
        {test.st === 'ready' && test.url && (
          <audio data-testid="audio-test-player" controls src={test.url} />
        )}
        {test.st === 'error' && <span className="audio-test-err">{test.error}</span>}
        <p className="muted">Records 6 seconds of your actual stream output — speak, and check your game is audible.</p>
      </div>
```

- [ ] **Step 4: CSS**

Append to styles.css near the audio styles:
```css
/* Stream audio check */
.audio-test { border-top: 1px solid rgba(255,255,255,.08); margin-top: 14px; padding-top: 10px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.audio-test audio { width: 100%; height: 32px; }
.audio-test-err { font-size: 12px; font-weight: 600; color: #f85149; }
```

- [ ] **Step 5: Run to verify tests pass, then full suite + tsc**

Run: `npm -w @axistream/app run test -- audio-settings` — expected PASS.
Run: `npm -w @axistream/app run test` — expected all pass.
Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` — expected zero errors.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/components/AudioSettings.tsx packages/app/src/renderer/styles.css packages/app/test/audio-settings.test.tsx
git commit -m "feat(audio-check): Test audio UI — countdown, playback, error states"
```

---

## Self-Review

- **Spec coverage:** RecordController with exact profile params + error ladder (Task 1) ✓; IPC channel/type/handler with live-phase+capture guard, Buffer transport, unlink-after-read, boot sweep (Task 2) ✓; UI idle/recording/ready/error with countdown, blob playback, revoke-on-replace, phase-gated enable (Task 3) ✓.
- **Type consistency:** `TestRecordingResult` (controller) vs `AudioTestResult` (shared) are distinct on purpose — the shared type carries the clip bytes; handler maps between them. `recordTestClip(6000, app.getPath('temp'))` matches the Task 1 signature. `AudioSettings` consumes only `recordAudioTest` + existing `phase`.
- **Placeholder scan:** none — full code in every step.
- **Note:** Task 1's StopRecord-retry test builds its own client rather than the harness (the harness can't count per-request throws); it dynamically imports the class to keep one import path — acceptable test-local pattern.
