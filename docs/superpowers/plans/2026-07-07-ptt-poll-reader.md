# PTT Evdev Poll Reader + Rebind Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the threadpool-starving `createReadStream` evdev reader with a non-blocking poll reader, and make press-to-bind capture report timeout/cancel honestly with a visible countdown.

**Architecture:** `evdev-keys.ts` keeps its `EvdevDeps.openStream` interface; only the real implementation changes to `pollStream` (O_NONBLOCK + 25 ms readSync sweep — zero libuv threadpool usage). `captureNextKey` returns a `PttCaptureResult` union instead of `PttKey | null`, threaded through the `capturePttKey` IPC to the renderer, which shows a countdown and outcome message.

**Tech Stack:** Electron main (Node fs), TypeScript 5.5, vitest 2 (fork pool ≤2), React 18 renderer.

**Spec:** `docs/superpowers/specs/2026-07-07-ptt-poll-reader-design.md`

## Global Constraints

- Code style: 2-space indent, **no semicolons**, single quotes, named exports, `.js` extensions on relative imports (ESM/NodeNext).
- OBS/backend calls best-effort — nothing may throw out of the evdev backend.
- Tests: `npm -w @axistream/app run test` (vitest, fork pool capped at 2). Typecheck gate: `cd packages/app && npx tsc --noEmit -p tsconfig.json`.
- BTN_LEFT = 272, BTN_RIGHT = 273, KEY_ESC = 1, FRAME = 24 bytes, EV_KEY = 1.
- Capture timeout stays 10000 ms (default parameter).
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: `pollStream` reader in evdev-keys.ts

**Files:**
- Modify: `packages/app/src/main/evdev-keys.ts` (imports, add `pollStream`, swap `realDeps.openStream`)
- Test: `packages/app/test/evdev-keys.test.ts` (append a describe block)

**Interfaces:**
- Consumes: existing `EvdevDeps.openStream` shape `{ on(ev: 'data' | 'error', cb: (arg: never) => void): void; destroy(): void }`
- Produces: `export function pollStream(path: string, intervalMs = 25)` returning that same shape. `realDeps.openStream` becomes `(path) => pollStream(path) as never`. Nothing else in the file changes.

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/test/evdev-keys.test.ts` (the `frame` helper already exists at the top of the file; extend the import line to include `pollStream`):

```ts
describe('pollStream (fifo integration)', () => {
  it('delivers written frames and stops after destroy', async () => {
    const fifo = join(tmpdir(), `axistream-fifo-${process.pid}-${Math.random().toString(36).slice(2)}`)
    execSync(`mkfifo ${fifo}`)
    const s = pollStream(fifo, 5)
    const chunks: Buffer[] = []
    s.on('data', ((b: Buffer) => { chunks.push(b) }) as never)
    s.on('error', (() => { /* ignore */ }) as never)
    const w = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK)
    try {
      writeSync(w, frame(1, 188, 1))
      await new Promise((r) => setTimeout(r, 60))
      expect(Buffer.concat(chunks).length).toBeGreaterThanOrEqual(24)
      s.destroy()
      const before = Buffer.concat(chunks).length
      writeSync(w, frame(1, 188, 0))
      await new Promise((r) => setTimeout(r, 40))
      expect(Buffer.concat(chunks).length).toBe(before)
    } finally {
      closeSync(w)
      unlinkSync(fifo)
    }
  })

  it('emits error (not a throw) for an unopenable path', async () => {
    const s = pollStream('/nonexistent-dir/nope', 5)
    const err = await new Promise<Error>((resolve) => { s.on('error', ((e: Error) => resolve(e)) as never) })
    expect(err.message).toMatch(/ENOENT/)
  })
})
```

New test-file imports needed at the top:

```ts
import { execSync } from 'node:child_process'
import { openSync, writeSync, closeSync, unlinkSync, constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
```

and extend the existing evdev import to `import { parseInputEvents, createEvdevShortcuts, captureNextKey, pollStream } from '../src/main/evdev-keys.js'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm -w @axistream/app run test -- evdev-keys`
Expected: FAIL — `pollStream` is not exported.

- [ ] **Step 3: Implement pollStream**

In `packages/app/src/main/evdev-keys.ts`, change the fs import to:

```ts
import { readdirSync, openSync, closeSync, readSync, constants } from 'node:fs'
```

(`createReadStream` is dropped.) Then add above `realDeps`:

```ts
/** Poll-based evdev reader. fs.createReadStream's blocking reads ride
 *  libuv's 4-thread pool — 40+ never-returning device reads starve it and
 *  every stream goes silent (PTT dead once the pass-through unlock makes
 *  all /dev/input nodes readable). Non-blocking opens + a 25 ms readSync
 *  sweep never touch the pool. */
export function pollStream(path: string, intervalMs = 25): { on(ev: 'data' | 'error', cb: (arg: never) => void): void; destroy(): void } {
  let onData: ((b: Buffer) => void) | null = null
  let onError: ((e: Error) => void) | null = null
  let fd = -1
  let openErr: Error | null = null
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK) } catch (e) { openErr = e as Error }
  const buf = Buffer.alloc(FRAME * 64)
  const destroy = () => {
    if (timer) clearInterval(timer)
    if (fd >= 0) { try { closeSync(fd) } catch { /* ignore */ } }
    fd = -1
  }
  const timer = openErr ? null : setInterval(() => {
    for (;;) {
      let n: number
      try { n = readSync(fd, buf, 0, buf.length, null) } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EAGAIN') return
        destroy()
        onError?.(e as Error)  // e.g. ENODEV on unplug — bind prunes, capture's timeout covers
        return
      }
      if (n <= 0) return
      onData?.(Buffer.from(buf.subarray(0, n)))
      if (n < buf.length) return  // drained
    }
  }, intervalMs)
  return {
    on: (ev, cb) => {
      if (ev === 'data') { onData = cb as never; return }
      onError = cb as never
      if (openErr) queueMicrotask(() => onError?.(openErr as Error))
    },
    destroy,
  }
}
```

And in `realDeps`, replace the `openStream` entry (and its now-stale comment about ReadStream overloads) with:

```ts
  openStream: (path) => pollStream(path) as never,
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm -w @axistream/app run test -- evdev-keys` — expected: PASS (all existing + 2 new).
Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` — expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/evdev-keys.ts packages/app/test/evdev-keys.test.ts
git commit -m "fix(ptt): poll-based evdev reader — createReadStream starved the libuv pool

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Capture outcome union through the IPC

**Files:**
- Modify: `packages/app/src/shared/keys.ts` (add `PttCaptureResult`)
- Modify: `packages/app/src/main/evdev-keys.ts` (`captureNextKey` return type + click filter)
- Modify: `packages/app/src/main/index.ts` (`capturePttKey` handler, ~line 552)
- Modify: `packages/app/src/preload/index.ts` (line 47), `packages/app/src/shared/state.ts` (line 164)
- Test: `packages/app/test/evdev-keys.test.ts` (update the two `captureNextKey` describes)

**Interfaces:**
- Consumes: `pollStream`-backed `realDeps` from Task 1 (unchanged shape); `keyName(code)` from `shared/keys.ts`.
- Produces: `export type PttCaptureResult = { key: PttKey } | { reason: 'timeout' | 'cancelled' | 'unavailable' }` in `shared/keys.ts`; `captureNextKey(deps?, timeoutMs?): Promise<PttCaptureResult>`; IPC `capturePttKey(): Promise<PttCaptureResult>`. Task 3's renderer consumes exactly this union.

- [ ] **Step 1: Update the capture tests to the union (failing first)**

In `packages/app/test/evdev-keys.test.ts`, rewrite the two capture describes:

```ts
describe('captureNextKey', () => {
  function capHarness() {
    const devs = { '/dev/input/event3': fakeDevice() }
    return { devs, deps: {
      listDevices: () => Object.keys(devs),
      canRead: () => true,
      openStream: (p: string) => devs[p as keyof typeof devs].stream as never,
    } }
  }
  it('resolves with the first keydown, named from the table', async () => {
    const h = capHarness()
    const p = captureNextKey(h.deps, 5000)
    h.devs['/dev/input/event3'].emitData(frame(1, 185, 1))
    expect(await p).toEqual({ key: { code: 185, name: 'F15' } })
    expect(h.devs['/dev/input/event3'].stream.destroy).toHaveBeenCalled()
  })
  it('ignores releases, non-key events, and plain clicks; Escape cancels', async () => {
    const h = capHarness()
    const p = captureNextKey(h.deps, 5000)
    const dev = h.devs['/dev/input/event3']
    dev.emitData(frame(1, 185, 0))  // release — ignored
    dev.emitData(frame(2, 0, 1))    // EV_REL — ignored
    dev.emitData(frame(1, 272, 1))  // BTN_LEFT — ignored, capture continues
    dev.emitData(frame(1, 273, 1))  // BTN_RIGHT — ignored
    dev.emitData(frame(1, 1, 1))    // Escape — cancel
    expect(await p).toEqual({ reason: 'cancelled' })
  })
  it('times out', async () => {
    const h = capHarness()
    expect(await captureNextKey(h.deps, 10)).toEqual({ reason: 'timeout' })
  })
  it('reports unavailable when nothing is readable', async () => {
    const deps = { listDevices: () => ['/dev/input/event3'], canRead: () => false, openStream: () => { throw new Error('unreachable') } }
    expect(await captureNextKey(deps as never, 10)).toEqual({ reason: 'unavailable' })
  })
})

describe('captureNextKey accepts any key', () => {
  it('captures an off-table key (mouse side button) with a KEY_<n> name', async () => {
    const devs = { '/dev/input/event3': fakeDevice() }
    const p = captureNextKey({
      listDevices: () => Object.keys(devs),
      canRead: () => true,
      openStream: (d: string) => devs[d as keyof typeof devs].stream as never,
    }, 5000)
    devs['/dev/input/event3'].emitData(frame(1, 275, 1))  // BTN_SIDE — off-table
    expect(await p).toEqual({ key: { code: 275, name: 'KEY_275' } })
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm -w @axistream/app run test -- evdev-keys`
Expected: FAIL — captureNextKey still resolves `PttKey | null`.

- [ ] **Step 3: Implement the union**

`packages/app/src/shared/keys.ts` — add after the `PttKey` interface:

```ts
export type PttCaptureResult =
  | { key: PttKey }
  | { reason: 'timeout' | 'cancelled' | 'unavailable' }
```

`packages/app/src/main/evdev-keys.ts` — extend the shared import to `import { keyName, type PttKey, type PttCaptureResult } from '../shared/keys.js'`, add `const BTN_LEFT = 272` and `const BTN_RIGHT = 273` next to `KEY_ESC`, and rework `captureNextKey`:

```ts
/** Resolve the next keydown seen on any readable device — the press-to-bind
 *  UX. Escape cancels; plain clicks are skipped (the Rebind click itself
 *  must never bind BTN_LEFT); the timeout and no-device cases report
 *  themselves so the UI can say what happened. All probe streams are
 *  destroyed on settle. */
export function captureNextKey(deps: EvdevDeps = realDeps, timeoutMs = 10000): Promise<PttCaptureResult> {
  return new Promise((resolve) => {
    const readable = deps.listDevices().filter((d) => deps.canRead(d))
    if (readable.length === 0) { resolve({ reason: 'unavailable' }); return }
    const streams: { destroy(): void }[] = []
    let done = false
    const settle = (result: PttCaptureResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      for (const s of streams) { try { s.destroy() } catch { /* ignore */ } }
      resolve(result)
    }
    const timer = setTimeout(() => settle({ reason: 'timeout' }), timeoutMs)
    for (const path of readable) {
      const stream = deps.openStream(path)
      streams.push(stream)
      let rest: Buffer = Buffer.alloc(0)
      stream.on('data', ((chunk: Buffer) => {
        const parsed = parseInputEvents(rest.length === 0 ? chunk : Buffer.concat([rest, chunk]))
        rest = parsed.rest
        for (const ev of parsed.events) {
          if (ev.type !== EV_KEY || ev.value !== 1) continue
          if (ev.code === KEY_ESC) { settle({ reason: 'cancelled' }); return }
          if (ev.code === BTN_LEFT || ev.code === BTN_RIGHT) continue
          // Accept ANY other key — "press any key" means what it says.
          // Off-table keys keep their code with a KEY_<n> name.
          settle({ key: { code: ev.code, name: keyName(ev.code) } })
          return
        }
      }) as never)
      stream.on('error', (() => { /* dead probe stream — timeout covers it */ }) as never)
    }
  })
}
```

`packages/app/src/main/index.ts` — extend the shared keys import with `type PttCaptureResult` (the file already imports from `../shared/keys.js`; if not, add it) and replace the `capturePttKey` handler body:

```ts
    capturePttKey: async (): Promise<PttCaptureResult> => {
      if (!(await evdevBackend.available())) return { reason: 'unavailable' }
      const wasEnabled = ptt.isEnabled()
      // the pressed key must never transmit: capture with PTT disarmed.
      // try/finally: captureNextKey never rejects today, but a future
      // rejection path must not strand PTT disabled.
      if (wasEnabled) await ptt.disable()
      let result: PttCaptureResult = { reason: 'timeout' }
      try {
        result = await captureNextKey()
        if ('key' in result) {
          settings.patch({ pttKeyCode: result.key.code, pttKeyName: result.key.name })
          setState({ ptt: { ...state.ptt, keyName: result.key.name } })
        }
      } finally {
        // re-sample intent: the user may have toggled PTT OFF while the
        // capture window was open — never resurrect an explicit disable
        if (wasEnabled && settings.load().pttEnabled) {
          const r = await ptt.enable()
          setState({ ptt: { ...state.ptt, enabled: r.ok, active: false, error: r.ok ? null : (r.error ?? 'failed'), mode: r.ok ? pttMode : null } })
        }
      }
      return result
    },
```

`packages/app/src/preload/index.ts` line 47 becomes (import `PttCaptureResult` alongside the existing `PttKey` type import):

```ts
  capturePttKey: () => ipcRenderer.invoke(CH.capturePttKey) as Promise<PttCaptureResult>,
```

`packages/app/src/shared/state.ts` line 164 becomes (add the type import from `./keys.js`):

```ts
  capturePttKey(): Promise<PttCaptureResult>
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm -w @axistream/app run test -- evdev-keys` — expected: PASS.
Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` — expected: clean (this catches every call site of the changed IPC — the renderer still compiles because Task 3 hasn't consumed the union yet; if `AudioSettings.tsx` fails to compile because it ignores the result, that's fine — it `await`s and discards, which stays valid).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared/keys.ts packages/app/src/main/evdev-keys.ts packages/app/src/main/index.ts packages/app/src/preload/index.ts packages/app/src/shared/state.ts packages/app/test/evdev-keys.test.ts
git commit -m "feat(ptt): capture outcome union — timeout/cancelled/unavailable are distinct; clicks can't bind

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Rebind countdown + outcome message

**Files:**
- Modify: `packages/app/src/renderer/components/AudioSettings.tsx` (the `rebind` handler ~line 42 and the passthrough block ~line 188)

**Interfaces:**
- Consumes: `axi().capturePttKey(): Promise<PttCaptureResult>` from Task 2; existing `capturing`/`setCapturing` state.
- Produces: UI only — no new exports.

- [ ] **Step 1: Implement the countdown + message states and handler**

Replace the `rebind` handler (keep the existing `capturing` state; add two new `useState` lines beside it):

```tsx
  const [captureLeft, setCaptureLeft] = useState(10)
  const [captureMsg, setCaptureMsg] = useState<string | null>(null)

  const rebind = async () => {
    setCapturing(true)
    setCaptureMsg(null)
    setCaptureLeft(10)
    const tick = setInterval(() => setCaptureLeft((s) => Math.max(0, s - 1)), 1000)
    try {
      const r = await axi().capturePttKey()
      if ('reason' in r) {
        setCaptureMsg(r.reason === 'cancelled' ? 'Cancelled'
          : r.reason === 'timeout' ? 'No key seen — timed out'
          : 'Pass-through unavailable')
      }
    } finally {
      clearInterval(tick)
      setCapturing(false)
    }
  }
```

And in the passthrough block (~line 188), replace the capture line:

```tsx
              {capturing
                ? <span className="muted">Press any key… {captureLeft}s (Esc cancels)</span>
                : <button className="btn ghost xs" onClick={rebind}>Rebind</button>}
              {captureMsg && !capturing && <p className="muted">{captureMsg}</p>}
```

- [ ] **Step 2: Typecheck and full test suite**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` — expected: clean.
Run: `npm -w @axistream/app run test` — expected: PASS (fork pool ≤2 per repo config).

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/renderer/components/AudioSettings.tsx
git commit -m "feat(ptt): rebind countdown + explicit timeout/cancel feedback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
