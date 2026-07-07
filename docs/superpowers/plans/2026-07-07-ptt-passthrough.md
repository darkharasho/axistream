# PTT Pass-Through (evdev) + One-Click Unlock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An observational evdev PTT backend (F18 passes through to Discord's own PTT) with a pkexec one-click unlock, auto-selected over the key-consuming portal backend when `/dev/input` is readable.

**Architecture:** `evdev-keys.ts` parses raw `input_event` frames from every readable `/dev/input/event*` and exposes the SAME `{ available, bind }` shape as `createPortalShortcuts`, so `PttController` is untouched; `index.ts` probes at each enable and picks evdev ("passthrough") or portal ("exclusive"), pushing `ptt.mode`; `input-unlock.ts` runs the pkexec udev-uaccess script and the handler re-arms PTT onto evdev after a successful unlock.

**Tech Stack:** Electron 31 main/renderer, TypeScript 5.5 (ESM/NodeNext), Vitest 2 (fork pool ≤2). No new dependencies.

## Global Constraints

- 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on all relative imports.
- Best-effort everywhere: nothing PTT-side may throw out or block boot/go-live; probe failures → portal mode; per-device stream errors dropped with a `console.warn`.
- `KEY_F18 = 188`; `EV_KEY = 1`; 64-bit `input_event` = 24 bytes LE (16 timeval skipped, u16 type, u16 code, s32 value); value 1 = press, 0 = release, 2 = repeat (ignored).
- udev rule file `/etc/udev/rules.d/70-axistream-input.rules`, content exactly `KERNEL=="event*", SUBSYSTEM=="input", TAG+="uaccess"`; followed by `udevadm control --reload-rules && udevadm trigger --subsystem-match=input`; all via `pkexec sh -c '…'`.
- `AppState.ptt.mode: 'passthrough' | 'exclusive' | null` (null = PTT never armed).
- UI copy verbatim: passthrough line `Key events pass through — Discord's own push-to-talk works alongside.`; exclusive line `AxiStream owns the key — Discord won't see F18.`; button `Enable pass-through (asks for your admin password)`; caveat `Grants apps in your session read access to input devices (required for pass-through).`
- vitest: `npm -w @axistream/app run test`. Typecheck gate: `cd packages/app && npx tsc --noEmit -p tsconfig.json`.

---

### Task 1: evdev-keys — parser + backend factory

**Files:**
- Create: `packages/app/src/main/evdev-keys.ts`
- Test: `packages/app/test/evdev-keys.test.ts`

**Interfaces:**
- Consumes: the `PortalShortcut`/`PortalDeps` shapes from `packages/app/src/main/PttController.ts` (structural — do NOT import PttController; re-declare locally like portal-shortcuts.ts does with `BoundShortcut`).
- Produces:
```ts
export interface InputEvent { type: number; code: number; value: number }
export function parseInputEvents(buf: Buffer): { events: InputEvent[]; rest: Buffer }
export const KEY_F18 = 188
export interface EvdevDeps {
  listDevices(): string[]                       // e.g. readdirSync('/dev/input') filtered to event*
  canRead(path: string): boolean                // openSync(path,'r')+closeSync probe
  openStream(path: string): { on(ev: 'data' | 'error', cb: (arg: never) => void): void; destroy(): void }
}
export function createEvdevShortcuts(deps?: EvdevDeps): { available(): Promise<boolean>; bind(id: string, description: string, preferredTrigger: string): Promise<BoundShortcut> }
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/test/evdev-keys.test.ts
import { describe, it, expect, vi } from 'vitest'
import { parseInputEvents, createEvdevShortcuts, KEY_F18 } from '../src/main/evdev-keys.js'

function frame(type: number, code: number, value: number): Buffer {
  const b = Buffer.alloc(24)
  b.writeUInt16LE(type, 16)
  b.writeUInt16LE(code, 18)
  b.writeInt32LE(value, 20)
  return b
}

describe('parseInputEvents', () => {
  it('parses whole frames and returns an empty remainder', () => {
    const buf = Buffer.concat([frame(1, KEY_F18, 1), frame(1, KEY_F18, 0)])
    const { events, rest } = parseInputEvents(buf)
    expect(events).toEqual([
      { type: 1, code: KEY_F18, value: 1 },
      { type: 1, code: KEY_F18, value: 0 },
    ])
    expect(rest.length).toBe(0)
  })

  it('carries a partial trailing frame as the remainder', () => {
    const buf = Buffer.concat([frame(1, KEY_F18, 1), frame(1, 30, 1).subarray(0, 10)])
    const { events, rest } = parseInputEvents(buf)
    expect(events).toHaveLength(1)
    expect(rest.length).toBe(10)
  })

  it('handles an empty buffer', () => {
    const { events, rest } = parseInputEvents(Buffer.alloc(0))
    expect(events).toEqual([])
    expect(rest.length).toBe(0)
  })
})

type Handler = (arg: unknown) => void
function fakeDevice() {
  const handlers: Record<string, Handler[]> = { data: [], error: [] }
  return {
    stream: {
      on: (ev: string, cb: Handler) => { handlers[ev].push(cb) },
      destroy: vi.fn(),
    },
    emitData: (b: Buffer) => handlers.data.forEach((cb) => cb(b)),
    emitError: (e: Error) => handlers.error.forEach((cb) => cb(e)),
  }
}

describe('createEvdevShortcuts', () => {
  function harness(readable = true) {
    const devs = { '/dev/input/event3': fakeDevice(), '/dev/input/event7': fakeDevice() }
    const backend = createEvdevShortcuts({
      listDevices: () => Object.keys(devs),
      canRead: () => readable,
      openStream: (p) => devs[p as keyof typeof devs].stream,
    })
    return { backend, devs }
  }

  it('available() reflects device readability', async () => {
    expect(await harness(true).backend.available()).toBe(true)
    expect(await harness(false).backend.available()).toBe(false)
  })

  it('fires activated/deactivated for F18 press/release; ignores repeats and other codes', async () => {
    const h = harness()
    const sc = await h.backend.bind('ptt', 'Push to talk', 'F18')
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    sc.onDeactivated(() => seq.push('up'))
    const dev = h.devs['/dev/input/event3']
    dev.emitData(frame(1, KEY_F18, 1))
    dev.emitData(frame(1, KEY_F18, 2))   // repeat — ignored
    dev.emitData(frame(1, 30, 1))        // KEY_A — ignored
    dev.emitData(frame(1, KEY_F18, 0))
    expect(seq).toEqual(['down', 'up'])
  })

  it('reassembles frames split across reads', async () => {
    const h = harness()
    const sc = await h.backend.bind('ptt', 'Push to talk', 'F18')
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    const f = frame(1, KEY_F18, 1)
    const dev = h.devs['/dev/input/event7']
    dev.emitData(f.subarray(0, 11))
    dev.emitData(f.subarray(11))
    expect(seq).toEqual(['down'])
  })

  it('a device stream error drops that device without throwing; close destroys all streams', async () => {
    const h = harness()
    const sc = await h.backend.bind('ptt', 'Push to talk', 'F18')
    h.devs['/dev/input/event3'].emitError(new Error('unplugged'))
    await sc.close()
    expect(h.devs['/dev/input/event7'].stream.destroy).toHaveBeenCalled()
  })

  it('bind rejects when nothing is readable', async () => {
    const h = harness(false)
    await expect(h.backend.bind('ptt', 'Push to talk', 'F18')).rejects.toThrow(/no readable input devices/i)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm -w @axistream/app run test -- evdev-keys`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/main/evdev-keys.ts
import { readdirSync, openSync, closeSync, createReadStream } from 'node:fs'

/** 64-bit input_event: 16 bytes timeval (skipped), u16 type, u16 code,
 *  s32 value — little-endian. */
const FRAME = 24
export const KEY_F18 = 188
const EV_KEY = 1

export interface InputEvent { type: number; code: number; value: number }

export function parseInputEvents(buf: Buffer): { events: InputEvent[]; rest: Buffer } {
  const events: InputEvent[] = []
  let off = 0
  while (off + FRAME <= buf.length) {
    events.push({
      type: buf.readUInt16LE(off + 16),
      code: buf.readUInt16LE(off + 18),
      value: buf.readInt32LE(off + 20),
    })
    off += FRAME
  }
  return { events, rest: buf.subarray(off) }
}

// Same shape as portal-shortcuts' BoundShortcut — structural on purpose so
// PttController accepts either backend unchanged.
export interface BoundShortcut { onActivated(cb: () => void): void; onDeactivated(cb: () => void): void; close(): Promise<void> }

export interface EvdevDeps {
  listDevices(): string[]
  canRead(path: string): boolean
  openStream(path: string): { on(ev: 'data' | 'error', cb: (arg: never) => void): void; destroy(): void }
}

const realDeps: EvdevDeps = {
  listDevices: () => {
    try {
      return readdirSync('/dev/input').filter((f) => f.startsWith('event')).map((f) => `/dev/input/${f}`)
    } catch { return [] }
  },
  canRead: (path) => {
    try { closeSync(openSync(path, 'r')); return true } catch { return false }
  },
  openStream: (path) => createReadStream(path) as never,
}

/** Observational PTT capture: reads every readable /dev/input/event* and
 *  watches for KEY_F18 edges. Nothing is grabbed or consumed — Discord's own
 *  PTT (and everything else) still receives the key. Non-keyboards simply
 *  never emit code 188. */
export function createEvdevShortcuts(deps: EvdevDeps = realDeps) {
  return {
    async available(): Promise<boolean> {
      return deps.listDevices().some((d) => deps.canRead(d))
    },

    async bind(_id: string, _description: string, _preferredTrigger: string): Promise<BoundShortcut> {
      const readable = deps.listDevices().filter((d) => deps.canRead(d))
      if (readable.length === 0) throw new Error('no readable input devices — pass-through is locked')
      let onAct: (() => void) | null = null
      let onDeact: (() => void) | null = null
      const streams = readable.map((path) => {
        const stream = deps.openStream(path)
        let rest = Buffer.alloc(0)
        stream.on('data', ((chunk: Buffer) => {
          const parsed = parseInputEvents(Buffer.concat([rest, chunk]))
          rest = parsed.rest
          for (const ev of parsed.events) {
            if (ev.type !== EV_KEY || ev.code !== KEY_F18) continue
            if (ev.value === 1) onAct?.()
            else if (ev.value === 0) onDeact?.()
            // value 2 = auto-repeat: ignored (the key is already down)
          }
        }) as never)
        stream.on('error', ((e: Error) => {
          console.warn(`[ptt] evdev device dropped (${path}):`, e.message)
        }) as never)
        return stream
      })
      return {
        onActivated: (cb) => { onAct = cb },
        onDeactivated: (cb) => { onDeact = cb },
        close: async () => { for (const s of streams) { try { s.destroy() } catch { /* ignore */ } } },
      }
    },
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm -w @axistream/app run test -- evdev-keys`
Expected: PASS (8/8).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/evdev-keys.ts packages/app/test/evdev-keys.test.ts
git commit -m "feat(ptt): evdev pass-through capture backend"
```

---

### Task 2: input-unlock — pkexec udev unlock

**Files:**
- Create: `packages/app/src/main/input-unlock.ts`
- Test: `packages/app/test/input-unlock.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
```ts
export function unlockScript(): string
export type ExecFileLike = (cmd: string, args: string[]) => Promise<void>   // rejects with { code? } on nonzero
export async function runInputUnlock(exec: ExecFileLike): Promise<{ ok: boolean; error?: string }>
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/test/input-unlock.test.ts
import { describe, it, expect, vi } from 'vitest'
import { unlockScript, runInputUnlock } from '../src/main/input-unlock.js'

describe('unlockScript', () => {
  it('pins the exact rule file, rule content, and udevadm sequence', () => {
    const s = unlockScript()
    expect(s).toContain('/etc/udev/rules.d/70-axistream-input.rules')
    expect(s).toContain('KERNEL=="event*", SUBSYSTEM=="input", TAG+="uaccess"')
    expect(s).toContain('udevadm control --reload-rules')
    expect(s).toContain('udevadm trigger --subsystem-match=input')
  })
})

describe('runInputUnlock', () => {
  it('runs the script via pkexec sh -c and reports success', async () => {
    const exec = vi.fn(async () => {})
    const r = await runInputUnlock(exec)
    expect(r).toEqual({ ok: true })
    expect(exec).toHaveBeenCalledWith('pkexec', ['sh', '-c', unlockScript()])
  })

  it('maps a cancelled/denied pkexec auth to a friendly message', async () => {
    for (const code of [126, 127]) {
      const exec = vi.fn(async () => { throw Object.assign(new Error(`exit ${code}`), { code }) })
      const r = await runInputUnlock(exec)
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/authorization was cancelled/i)
    }
  })

  it('passes other failures through as the error message', async () => {
    const exec = vi.fn(async () => { throw new Error('pkexec not found') })
    const r = await runInputUnlock(exec)
    expect(r).toEqual({ ok: false, error: 'pkexec not found' })
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm -w @axistream/app run test -- input-unlock`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/main/input-unlock.ts
const RULE_FILE = '/etc/udev/rules.d/70-axistream-input.rules'
const RULE = 'KERNEL=="event*", SUBSYSTEM=="input", TAG+="uaccess"'

/** The exact shell that runs as root via pkexec. uaccess tags grant the
 *  active seat's user ACL read access to input devices IMMEDIATELY after
 *  the udev trigger — no relogin, unlike group membership. */
export function unlockScript(): string {
  return `printf '%s\\n' '${RULE}' > ${RULE_FILE} && udevadm control --reload-rules && udevadm trigger --subsystem-match=input`
}

export type ExecFileLike = (cmd: string, args: string[]) => Promise<void>

export async function runInputUnlock(exec: ExecFileLike): Promise<{ ok: boolean; error?: string }> {
  try {
    await exec('pkexec', ['sh', '-c', unlockScript()])
    return { ok: true }
  } catch (e) {
    const code = (e as { code?: number }).code
    // pkexec: 126 = auth dialog dismissed, 127 = not authorized
    if (code === 126 || code === 127) return { ok: false, error: 'Authorization was cancelled' }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm -w @axistream/app run test -- input-unlock`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/input-unlock.ts packages/app/test/input-unlock.test.ts
git commit -m "feat(ptt): pkexec udev-uaccess unlock for pass-through"
```

---

### Task 3: mode selection, state, IPC wiring

**Files:**
- Modify: `packages/app/src/shared/state.ts:40` (ptt shape), `:54` (INITIAL_STATE), CH block (~113), AxiApi (~154)
- Modify: `packages/app/src/main/ipc.ts` (Handlers + registration)
- Modify: `packages/app/src/preload/index.ts` (binding)
- Modify: `packages/app/src/main/index.ts` (~211 construction, ~513 setPttEnabled, boot block)
- Possibly touch (ONLY if tsc flags): test files with full ptt literals (they use 4-field ptt objects — the new `mode` field must be added, e.g. `mode: null`).

**Interfaces:**
- Consumes: `createEvdevShortcuts` (Task 1), `runInputUnlock` (Task 2), existing `createPortalShortcuts` + `PttController`.
- Produces: `AppState.ptt.mode: 'passthrough' | 'exclusive' | null`; `AxiApi.unlockPassthrough(): Promise<{ ok: boolean; error?: string }>`; `CH.unlockPassthrough = 'axi:unlockPassthrough'`.

- [ ] **Step 1: state.ts changes**

Line 40: `ptt: { available: boolean; enabled: boolean; active: boolean; error: string | null; mode: 'passthrough' | 'exclusive' | null }`
Line 54: `ptt: { available: false, enabled: false, active: false, error: null, mode: null },`
CH: `unlockPassthrough: 'axi:unlockPassthrough',` — AxiApi: `unlockPassthrough(): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 2: ipc.ts + preload**

Handlers: `unlockPassthrough(): Promise<{ ok: boolean; error?: string }>`; registration `ipcMain.handle(CH.unlockPassthrough, () => handlers.unlockPassthrough())`; preload `unlockPassthrough: () => ipcRenderer.invoke(CH.unlockPassthrough) as Promise<{ ok: boolean; error?: string }>,`.

- [ ] **Step 3: index.ts — backend selection**

Imports:
```ts
import { createEvdevShortcuts } from './evdev-keys.js'
import { runInputUnlock } from './input-unlock.js'
```
Replace the construction at ~line 211. The portal dep becomes a selector that probes evdev per call and records the mode:
```ts
  const portalBackend = createPortalShortcuts()
  const evdevBackend = createEvdevShortcuts()
  let pttMode: 'passthrough' | 'exclusive' | null = null
  // Probed at every enable (not boot-cached) so the pkexec unlock upgrades
  // the running app without a restart.
  const selectBackend = async () => (await evdevBackend.available())
    ? { backend: evdevBackend, mode: 'passthrough' as const }
    : { backend: portalBackend, mode: 'exclusive' as const }
  const ptt = new PttController({
    portal: {
      available: async () => (await evdevBackend.available()) || (await portalBackend.available()),
      bind: async (id, description, preferredTrigger) => {
        const sel = await selectBackend()
        pttMode = sel.mode
        return sel.backend.bind(id, description, preferredTrigger)
      },
    },
    exec: execAsync,
    ...
  })
```
(Keep the existing `exec`, `sourceId`, `onActive` fields exactly as they are.)

Handler (near setPttEnabled ~513) — extend the two state pushes to carry the mode, and add the unlock handler:
```ts
    setPttEnabled: async (enabled) => {
      settings.patch({ pttEnabled: enabled })
      if (enabled) {
        const r = await ptt.enable()
        setState({ ptt: { ...state.ptt, enabled: r.ok, active: false, error: r.ok ? null : (r.error ?? 'failed'), mode: r.ok ? pttMode : null } })
      } else {
        await ptt.disable()
        setState({ ptt: { ...state.ptt, enabled: false, active: false, error: null, mode: null } })
      }
    },
    unlockPassthrough: async () => {
      const r = await runInputUnlock(execAsync)
      if (r.ok && ptt.isEnabled()) {
        // upgrade in place: closing the portal binding releases F18 to Discord
        await ptt.disable()
        const en = await ptt.enable()
        setState({ ptt: { ...state.ptt, enabled: en.ok, active: false, error: en.ok ? null : (en.error ?? 'failed'), mode: en.ok ? pttMode : null } })
      }
      return r
    },
```
Boot re-arm block: extend its state push the same way (`mode: r.ok ? pttMode : null`).

- [ ] **Step 4: Typecheck + full suite; patch flagged ptt literals minimally**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` — add `mode: null` (or a literal mode where a test needs one) to any flagged 5-field ptt literal; nothing else.
Run: `npm -w @axistream/app run test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/main/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/index.ts packages/app/test/
git commit -m "feat(ptt): backend auto-select (evdev passthrough / portal exclusive) + unlock IPC"
```

---

### Task 4: settings UI — mode line + unlock button

**Files:**
- Modify: `packages/app/src/renderer/components/AudioSettings.tsx` (PTT block, ~line 163-175)
- Modify: `packages/app/src/renderer/styles.css`
- Test: `packages/app/test/audio-settings.test.tsx`

**Interfaces:**
- Consumes: `ptt.mode` (Task 3), `axi().unlockPassthrough()` (Task 3).
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Add `unlockPassthrough: vi.fn(async () => ({ ok: true }))` to the axi mock. Update the `pttOff` helper and any explicit ptt literals with `mode: null` (Task 3 already type-forced this; verify). New tests:

```ts
  it('shows the pass-through mode line when armed via evdev', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: true, enabled: true, active: false, error: null, mode: 'passthrough' }} />)
    expect(screen.getByText(/Discord's own push-to-talk works alongside/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /enable pass-through/i })).not.toBeInTheDocument()
  })

  it('exclusive mode shows the warning line and the unlock button; clicking unlocks', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: true, enabled: true, active: false, error: null, mode: 'exclusive' }} />)
    expect(screen.getByText(/Discord won't see F18/i)).toBeInTheDocument()
    expect(screen.getByText(/read access to input devices/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /enable pass-through/i }))
    await waitFor(() => expect(axi.unlockPassthrough).toHaveBeenCalled())
  })

  it('surfaces an unlock failure inline', async () => {
    axi.unlockPassthrough.mockResolvedValueOnce({ ok: false, error: 'Authorization was cancelled' })
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: true, enabled: true, active: false, error: null, mode: 'exclusive' }} />)
    fireEvent.click(screen.getByRole('button', { name: /enable pass-through/i }))
    await waitFor(() => expect(screen.getByText(/authorization was cancelled/i)).toBeInTheDocument())
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm -w @axistream/app run test -- audio-settings`
Expected: FAIL — no mode line / button.

- [ ] **Step 3: Implement**

Local state near the other PTT state: `const [unlockErr, setUnlockErr] = useState<string | null>(null)`.
Handler:
```ts
  const unlock = async () => {
    setUnlockErr(null)
    const r = await axi().unlockPassthrough()
    if (!r.ok) setUnlockErr(r.error ?? 'Unlock failed')
  }
```
Inside the PTT block (after the `ptt.error` line, before the Discord note), add:
```tsx
          {ptt.enabled && ptt.mode === 'passthrough' && (
            <p className="muted">Key events pass through — Discord's own push-to-talk works alongside.</p>
          )}
          {ptt.enabled && ptt.mode === 'exclusive' && (
            <>
              <p className="muted">AxiStream owns the key — Discord won't see F18.</p>
              <button className="btn ghost xs" onClick={unlock}>Enable pass-through (asks for your admin password)</button>
              <p className="muted">Grants apps in your session read access to input devices (required for pass-through).</p>
              {unlockErr && <p className="ptt-err">{unlockErr}</p>}
            </>
          )}
```

- [ ] **Step 4: Run tests, full suite, typecheck**

Run: `npm -w @axistream/app run test -- audio-settings` → PASS.
Run: `npm -w @axistream/app run test` → all pass.
Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` → zero errors.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/renderer/components/AudioSettings.tsx packages/app/src/renderer/styles.css packages/app/test/audio-settings.test.tsx
git commit -m "feat(ptt): mode line + one-click pass-through unlock in settings"
```

(If no CSS change ends up needed — the block reuses existing classes — drop styles.css from the commit.)

---

## Self-Review

- **Spec coverage:** parser + evdev backend incl. partial frames, repeat-ignore, device-drop, probe (Task 1) ✓; pkexec unlock with exact rule + friendly cancel mapping (Task 2) ✓; per-enable probe, mode push, in-place upgrade re-arm, unlock IPC (Task 3) ✓; UI mode lines, button-only-when-exclusive, caveat copy, inline errors (Task 4) ✓; portal kept as fallback ✓; source-gate rails untouched ✓.
- **Type consistency:** `BoundShortcut` re-declared structurally in evdev-keys (mirrors portal-shortcuts precedent); `createEvdevShortcuts().bind(id, description, preferredTrigger)` matches the PortalDeps shape PttController consumes; `ptt.mode` union identical across Tasks 3/4; `unlockPassthrough` return `{ ok, error? }` consistent across ipc/preload/UI.
- **Placeholder scan:** none — full code in every step.
- **Note for the executor:** Task 3's `selectBackend`/`pttMode` snippet elides the unchanged `exec`/`sourceId`/`onActive` fields with `...` — those lines already exist at index.ts:211-219 and must be preserved verbatim.
