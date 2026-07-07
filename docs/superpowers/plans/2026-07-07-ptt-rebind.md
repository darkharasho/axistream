# Settable PTT Hotkey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The PTT key becomes user-settable in-app: press-any-key capture in pass-through mode, a curated dropdown in exclusive mode; every hardcoded F18 goes dynamic.

**Architecture:** A shared `{ code, name }` key type + curated table (`shared/keys.ts`); both backends' `bind` takes the key (evdev filters `code`, portal hints `name`); `PttController` gains a `key()` dep read fresh per enable; `setPttKey`/`capturePttKey` IPC drive the two rebind UXs with the existing disable→enable re-arm; `ptt.keyName` in state feeds all UI copy.

**Tech Stack:** Electron 31, TypeScript 5.5 (ESM/NodeNext), Vitest 2 (fork pool ≤2). No new dependencies.

## Global Constraints

- 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on all relative imports.
- Defaults preserve today's behavior: `pttKeyCode: 188`, `pttKeyName: 'F18'`.
- Sanitize: code must be an integer 1..767 else default; name must be a non-empty string else default.
- Key codes (input-event-codes.h) verbatim: F1-F10 = 59-68, F11 = 87, F12 = 88, F13-F24 = 183-194, Pause = 119, ScrollLock = 70, Insert = 110, Home = 102, End = 107, PageUp = 104, PageDown = 109. Escape = 1 cancels capture.
- During `capturePttKey`, PTT must be disabled first and re-enabled after (whether or not a key was captured) so the pressed key never transmits.
- Best-effort throughout; the unlock/mode machinery and source-gate safety rails are untouched.
- IMPLEMENTER GATES for every task: focused vitest, then FULL `npm -w @axistream/app run test`, then FULL `cd packages/app && npx tsc --noEmit -p tsconfig.json` — all three, every task.

---

### Task 1: shared key table + settings fields

**Files:**
- Create: `packages/app/src/shared/keys.ts`
- Modify: `packages/app/src/main/StreamSettings.ts` (interface after `masksVisible`, DEFAULT_SETTINGS, sanitize block ~line 113)
- Test: `packages/app/test/keys.test.ts`, append to `packages/app/test/stream-settings.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
```ts
// shared/keys.ts
export interface PttKey { code: number; name: string }
export const PTT_KEY_CHOICES: PttKey[]
export function keyName(code: number): string
// StreamSettingsData gains: pttKeyCode: number; pttKeyName: string
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/test/keys.test.ts
import { describe, it, expect } from 'vitest'
import { PTT_KEY_CHOICES, keyName } from '../src/shared/keys.js'

describe('PTT key table', () => {
  it('pins the codes that matter', () => {
    const byName = Object.fromEntries(PTT_KEY_CHOICES.map((k) => [k.name, k.code]))
    expect(byName['F13']).toBe(183)
    expect(byName['F18']).toBe(188)
    expect(byName['F24']).toBe(194)
    expect(byName['F1']).toBe(59)
    expect(byName['F11']).toBe(87)
    expect(byName['F12']).toBe(88)
    expect(byName['Pause']).toBe(119)
  })
  it('has no duplicate codes or names', () => {
    expect(new Set(PTT_KEY_CHOICES.map((k) => k.code)).size).toBe(PTT_KEY_CHOICES.length)
    expect(new Set(PTT_KEY_CHOICES.map((k) => k.name)).size).toBe(PTT_KEY_CHOICES.length)
  })
  it('keyName falls back to KEY_<code> off the table', () => {
    expect(keyName(188)).toBe('F18')
    expect(keyName(30)).toBe('KEY_30')
  })
})
```

```ts
// append inside the existing describe in packages/app/test/stream-settings.test.ts
  it('defaults the PTT key to F18/188, round-trips, and sanitizes garbage', () => {
    const s = new StreamSettings(file)
    expect(s.load().pttKeyCode).toBe(188)
    expect(s.load().pttKeyName).toBe('F18')
    s.patch({ pttKeyCode: 185, pttKeyName: 'F15' })
    const reloaded = new StreamSettings(file).load()
    expect(reloaded.pttKeyCode).toBe(185)
    expect(reloaded.pttKeyName).toBe('F15')
    s.save({ ...DEFAULT_SETTINGS, pttKeyCode: 9999 as never, pttKeyName: '' as never })
    const clean = new StreamSettings(file).load()
    expect(clean.pttKeyCode).toBe(188)
    expect(clean.pttKeyName).toBe('F18')
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm -w @axistream/app run test -- keys stream-settings`
Expected: FAIL — module missing / fields undefined.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/shared/keys.ts
export interface PttKey { code: number; name: string }

// evdev keycodes from linux input-event-codes.h — the curated picker set.
export const PTT_KEY_CHOICES: PttKey[] = [
  ...Array.from({ length: 10 }, (_, i) => ({ code: 59 + i, name: `F${i + 1}` })),
  { code: 87, name: 'F11' },
  { code: 88, name: 'F12' },
  ...Array.from({ length: 12 }, (_, i) => ({ code: 183 + i, name: `F${i + 13}` })),
  { code: 119, name: 'Pause' },
  { code: 70, name: 'ScrollLock' },
  { code: 110, name: 'Insert' },
  { code: 102, name: 'Home' },
  { code: 107, name: 'End' },
  { code: 104, name: 'PageUp' },
  { code: 109, name: 'PageDown' },
]

const NAMES = new Map(PTT_KEY_CHOICES.map((k) => [k.code, k.name]))

export function keyName(code: number): string {
  return NAMES.get(code) ?? `KEY_${code}`
}
```

`StreamSettings.ts` — after `masksVisible: boolean`:
```ts
  pttKeyCode: number
  pttKeyName: string
```
DEFAULT_SETTINGS: `pttKeyCode: 188,` and `pttKeyName: 'F18',`
Sanitize block (after the `masksVisible` line):
```ts
        pttKeyCode: Number.isInteger(raw.pttKeyCode) && (raw.pttKeyCode as number) >= 1 && (raw.pttKeyCode as number) <= 767 ? raw.pttKeyCode as number : DEFAULT_SETTINGS.pttKeyCode,
        pttKeyName: typeof raw.pttKeyName === 'string' && raw.pttKeyName ? raw.pttKeyName : DEFAULT_SETTINGS.pttKeyName,
```

- [ ] **Step 4: Run to verify they pass, then full gates**

Run: `npm -w @axistream/app run test -- keys stream-settings` → PASS.
Run: `npm -w @axistream/app run test` → all pass. `cd packages/app && npx tsc --noEmit -p tsconfig.json` → zero errors.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared/keys.ts packages/app/src/main/StreamSettings.ts packages/app/test/keys.test.ts packages/app/test/stream-settings.test.ts
git commit -m "feat(ptt): shared key table + persisted pttKeyCode/pttKeyName"
```

---

### Task 2: backends take the key; captureNextKey

**Files:**
- Modify: `packages/app/src/main/PttController.ts:5,33` (PortalDeps.bind signature + enable call + new `key()` dep)
- Modify: `packages/app/src/main/evdev-keys.ts:6,59,75` (bind signature filters the passed code; retire KEY_F18; add captureNextKey)
- Modify: `packages/app/src/main/portal-shortcuts.ts:94,120` (bind takes PttKey, hints `key.name`)
- Test: extend `packages/app/test/ptt-controller.test.ts`, `packages/app/test/evdev-keys.test.ts`, `packages/app/test/portal-shortcuts.test.ts`

**Interfaces:**
- Consumes: `PttKey`, `keyName` from `../shared/keys.js` (Task 1).
- Produces:
```ts
// PttController: PortalDeps.bind(id: string, description: string, key: PttKey): Promise<PortalShortcut>
//                PttDeps gains key(): PttKey; enable() calls this.d.portal.bind('ptt', 'Push to talk', this.d.key())
// evdev-keys:    bind(_id, _description, key: PttKey) — filters ev.code === key.code
//                export function captureNextKey(deps?: EvdevDeps, timeoutMs = 10000): Promise<PttKey | null>
// portal-shortcuts: bind(id, description, key: PttKey) — preferred_trigger = key.name
```

- [ ] **Step 1: Update existing tests + add new ones (failing)**

Mechanical updates — every existing `bind('ptt', 'Push to talk', 'F18')` in the three test files becomes `bind('ptt', 'Push to talk', { code: 188, name: 'F18' })`. The ptt-controller harness gains `key: () => ({ code: 188, name: 'F18' })` in its PttDeps. Then add:

```ts
// ptt-controller.test.ts — inside the existing describe
  it('enable binds with the key from the key() dep', async () => {
    let bound: unknown = null
    const ctl = new PttController({
      portal: { available: async () => true, bind: async (_i, _d, key) => { bound = key; return { onActivated: () => {}, onDeactivated: () => {}, close: async () => {} } } },
      exec: async () => {}, sourceId: () => 's', onActive: () => {},
      key: () => ({ code: 185, name: 'F15' }),
    })
    await ctl.enable()
    expect(bound).toEqual({ code: 185, name: 'F15' })
  })
```

```ts
// evdev-keys.test.ts — new describes
describe('createEvdevShortcuts key parameter', () => {
  it('filters on the PASSED code, not 188', async () => {
    const h = harness()
    const sc = await h.backend.bind('ptt', 'Push to talk', { code: 185, name: 'F15' })
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    const dev = h.devs['/dev/input/event3']
    dev.emitData(frame(1, KEY_F18, 1))   // old key — must NOT fire
    dev.emitData(frame(1, 185, 1))
    expect(seq).toEqual(['down'])
  })
})

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
    expect(await p).toEqual({ code: 185, name: 'F15' })
    expect(h.devs['/dev/input/event3'].stream.destroy).toHaveBeenCalled()
  })
  it('ignores releases and non-key events; Escape cancels with null', async () => {
    const h = capHarness()
    const p = captureNextKey(h.deps, 5000)
    const dev = h.devs['/dev/input/event3']
    dev.emitData(frame(1, 185, 0))  // release — ignored
    dev.emitData(frame(2, 0, 1))    // EV_REL — ignored
    dev.emitData(frame(1, 1, 1))    // Escape — cancel
    expect(await p).toBeNull()
  })
  it('times out to null', async () => {
    const h = capHarness()
    expect(await captureNextKey(h.deps, 10)).toBeNull()
  })
})
```

```ts
// portal-shortcuts.test.ts — update the two bind() calls in the existing fake-bus tests to
// bind('ptt', 'Push to talk', { code: 188, name: 'F18' }) and add inside the bind describe:
  it('hints the portal with the key NAME', async () => {
    const f = fakeBus()
    let bindArgs: unknown[] = []
    const gs = { CreateSession: async () => { /* respond via matches path */ }, BindShortcuts: async (...a: unknown[]) => { bindArgs = a }, on: () => {}, removeListener: () => {} }
    // reuse the fakeBus flow: easiest is to assert via the existing happy-path test's gsIface —
    // extend fakeBus's BindShortcuts to record its args and assert the shortcuts arg contains
    // preferred_trigger Variant with value 'F18'.
  })
```
(Executor note: implement the portal assertion by extending the EXISTING `fakeBus` gsIface `BindShortcuts` to push its arguments into an array the test can inspect — assert `args[1][0][1].preferred_trigger.value === 'F18'`. Keep it inside the existing happy-path test rather than a broken new one if simpler; the requirement is: one assertion proving `key.name` reaches `preferred_trigger`.)

- [ ] **Step 2: Run to verify failures**

Run: `npm -w @axistream/app run test -- ptt-controller evdev-keys portal-shortcuts`
Expected: FAIL (signature mismatches + missing captureNextKey).

- [ ] **Step 3: Implement**

`PttController.ts`: `bind(id: string, description: string, key: PttKey): Promise<PortalShortcut>` (import `type PttKey` from `'../shared/keys.js'`); `PttDeps` gains `key(): PttKey`; enable() line 33 → `sc = await this.d.portal.bind('ptt', 'Push to talk', this.d.key())`.

`portal-shortcuts.ts`: signature `bind(id: string, description: string, key: PttKey)`; line ~120 `preferred_trigger: new Variant('s', key.name)`.

`evdev-keys.ts`: signature `bind(_id: string, _description: string, key: PttKey)`; the filter becomes `ev.code !== key.code`; delete the `KEY_F18` export (Task 1's table owns codes now — keep a local `const KEY_ESC = 1`); add:

```ts
import { keyName, type PttKey } from '../shared/keys.js'

/** Resolve the next keydown seen on any readable device — the press-to-bind
 *  UX. Escape cancels; timeout returns null. All probe streams are destroyed
 *  on settle. */
export function captureNextKey(deps: EvdevDeps = realDeps, timeoutMs = 10000): Promise<PttKey | null> {
  return new Promise((resolve) => {
    const readable = deps.listDevices().filter((d) => deps.canRead(d))
    if (readable.length === 0) { resolve(null); return }
    const streams: { destroy(): void }[] = []
    let done = false
    const settle = (result: PttKey | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      for (const s of streams) { try { s.destroy() } catch { /* ignore */ } }
      resolve(result)
    }
    const timer = setTimeout(() => settle(null), timeoutMs)
    for (const path of readable) {
      const stream = deps.openStream(path)
      streams.push(stream)
      let rest: Buffer = Buffer.alloc(0)
      stream.on('data', ((chunk: Buffer) => {
        const parsed = parseInputEvents(rest.length === 0 ? chunk : Buffer.concat([rest, chunk]))
        rest = parsed.rest
        for (const ev of parsed.events) {
          if (ev.type !== EV_KEY || ev.value !== 1) continue
          if (ev.code === KEY_ESC) { settle(null); return }
          settle({ code: ev.code, name: keyName(ev.code) })
          return
        }
      }) as never)
      stream.on('error', (() => { /* dead probe stream — timeout covers it */ }) as never)
    }
  })
}
```
Note: keep the `KEY_F18` test-file references working by importing 188 via the table or a literal — update the test file's `frame(1, KEY_F18, 1)` uses to a local `const KEY_F18 = 188` in the TEST file.

- [ ] **Step 4: Run focused, then FULL suite + FULL tsc**

Run: `npm -w @axistream/app run test -- ptt-controller evdev-keys portal-shortcuts` → PASS.
Run: `npm -w @axistream/app run test` → all pass (index.ts still compiles against the old selector — it passes a string today; expect tsc FAILURES here if Task 3 hasn't run: NO — this plan keeps the repo green per task, so ALSO apply the minimal index.ts change now: the selector's `bind: async (id, description, preferredTrigger)` becomes `bind: async (id, description, key)` delegating `sel.backend.bind(id, description, key)`, and the PttController construction gains `key: () => { const s = settings.load(); return { code: s.pttKeyCode, name: s.pttKeyName } }`. This is the type-driven minimum; the rebind IPC lands in Task 3.)
Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` → zero errors.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/PttController.ts packages/app/src/main/evdev-keys.ts packages/app/src/main/portal-shortcuts.ts packages/app/src/main/index.ts packages/app/test/
git commit -m "feat(ptt): key threaded through both backends + captureNextKey"
```

---

### Task 3: state, rebind IPC, capture flow

**Files:**
- Modify: `packages/app/src/shared/state.ts` (ptt shape + CH + AxiApi)
- Modify: `packages/app/src/main/ipc.ts`, `packages/app/src/main/preload/../preload/index.ts`
- Modify: `packages/app/src/main/index.ts` (keyName in pushes, setPttKey + capturePttKey handlers)
- Tests: tsc-driven literal patches only (`keyName: 'F18'` added to ptt literals).

**Interfaces:**
- Consumes: Tasks 1-2 (`PttKey`, `captureNextKey`, `createEvdevShortcuts().available`).
- Produces: `AppState.ptt.keyName: string` (INITIAL_STATE `'F18'`); `CH.setPttKey = 'axi:setPttKey'`, `CH.capturePttKey = 'axi:capturePttKey'`; `AxiApi.setPttKey(key: PttKey): Promise<void>`, `AxiApi.capturePttKey(): Promise<PttKey | null>`.

- [ ] **Step 1: state.ts**

ptt shape gains `keyName: string`; INITIAL_STATE ptt gains `keyName: 'F18'`. CH + AxiApi entries per Produces (import `type PttKey` from `'./keys.js'` in state.ts — same shared dir).

- [ ] **Step 2: ipc.ts + preload**

Handlers: `setPttKey(key: PttKey): Promise<void>`, `capturePttKey(): Promise<PttKey | null>`; registrations `ipcMain.handle(CH.setPttKey, (_e: unknown, key: PttKey) => handlers.setPttKey(key))`, `ipcMain.handle(CH.capturePttKey, () => handlers.capturePttKey())`; preload bindings mirroring existing style.

- [ ] **Step 3: index.ts**

Every ptt state push gains `keyName` (boot: `keyName: a.pttKeyName`; others: `keyName: settings.load().pttKeyName` or carried via spread — the boot availability push and all four mode-bearing pushes must end up with the CURRENT name). Handlers (near setPttEnabled):
```ts
    setPttKey: async (key) => {
      settings.patch({ pttKeyCode: key.code, pttKeyName: key.name })
      setState({ ptt: { ...state.ptt, keyName: key.name } })
      if (ptt.isEnabled()) {
        await ptt.disable()
        const r = await ptt.enable()
        setState({ ptt: { ...state.ptt, enabled: r.ok, active: false, error: r.ok ? null : (r.error ?? 'failed'), mode: r.ok ? pttMode : null } })
      }
    },
    capturePttKey: async () => {
      if (!(await evdevBackend.available())) return null
      const wasEnabled = ptt.isEnabled()
      // the pressed key must never transmit: capture with PTT disarmed
      if (wasEnabled) await ptt.disable()
      const key = await captureNextKey()
      if (key) {
        settings.patch({ pttKeyCode: key.code, pttKeyName: key.name })
        setState({ ptt: { ...state.ptt, keyName: key.name } })
      }
      if (wasEnabled) {
        const r = await ptt.enable()
        setState({ ptt: { ...state.ptt, enabled: r.ok, active: false, error: r.ok ? null : (r.error ?? 'failed'), mode: r.ok ? pttMode : null } })
      }
      return key
    },
```
Import `captureNextKey` from `'./evdev-keys.js'` and `type PttKey` from `'../shared/keys.js'`.

- [ ] **Step 4: FULL tsc (patch flagged ptt literals with `keyName: 'F18'` minimally) + FULL suite**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` → zero after patches. `npm -w @axistream/app run test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/main/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/index.ts packages/app/test/
git commit -m "feat(ptt): keyName state + setPttKey/capturePttKey rebind IPC"
```

---

### Task 4: UI — dynamic key + both rebind flows

**Files:**
- Modify: `packages/app/src/renderer/components/AudioSettings.tsx` (~163-190 PTT block)
- Modify: `packages/app/src/renderer/components/Sidebar.tsx:32` (tooltip)
- Test: append to `packages/app/test/audio-settings.test.tsx`; update sidebar test if its assertion mentions F18.

**Interfaces:**
- Consumes: `ptt.keyName`, `ptt.mode`, `axi().setPttKey`, `axi().capturePttKey`, `PTT_KEY_CHOICES` from `'../../shared/keys.js'`.
- Produces: nothing.

- [ ] **Step 1: Write the failing tests**

Mock additions: `setPttKey: vi.fn(async () => {})`, `capturePttKey: vi.fn(async (): Promise<{ code: number; name: string } | null> => ({ code: 185, name: 'F15' }))`. Update ptt literals for `keyName` (Task 3 already type-forced `keyName: 'F18'`). New tests:

```ts
  it('labels follow ptt.keyName', () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: true, enabled: true, active: false, error: null, mode: 'passthrough', keyName: 'F15' }} />)
    expect(screen.getByLabelText('Push to talk (hold F15)')).toBeInTheDocument()
    expect(screen.getByText(/hold F15 to talk/i)).toBeInTheDocument()
  })

  it('pass-through rebind captures a key', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: true, enabled: true, active: false, error: null, mode: 'passthrough', keyName: 'F18' }} />)
    fireEvent.click(screen.getByRole('button', { name: /rebind/i }))
    expect(screen.getByText(/press any key/i)).toBeInTheDocument()
    await waitFor(() => expect(axi.capturePttKey).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/press any key/i)).not.toBeInTheDocument())
  })

  it('exclusive rebind is a dropdown calling setPttKey', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: true, enabled: true, active: false, error: null, mode: 'exclusive', keyName: 'F18' }} />)
    fireEvent.change(screen.getByLabelText(/push-to-talk key/i), { target: { value: '183' } })
    expect(axi.setPttKey).toHaveBeenCalledWith({ code: 183, name: 'F13' })
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm -w @axistream/app run test -- audio-settings`
Expected: FAIL.

- [ ] **Step 3: Implement**

AudioSettings: local `const [capturing, setCapturing] = useState(false)`; handler:
```ts
  const rebind = async () => {
    setCapturing(true)
    try { await axi().capturePttKey() } finally { setCapturing(false) }
  }
```
Replace the hardcoded strings: aria-label + span → `Push to talk (hold ${ptt.keyName})`; muted pill → `` `muted — hold ${ptt.keyName} to talk` ``. In the mode block:
- passthrough: after the mode line — `{capturing ? <span className="muted">Press any key… (Esc to cancel)</span> : <button className="btn ghost xs" onClick={rebind}>Rebind</button>}`
- exclusive: after the mode/unlock lines —
```tsx
              <label className="muted">Push-to-talk key
                <select value={String(PTT_KEY_CHOICES.find((k) => k.name === ptt.keyName)?.code ?? 188)}
                  onChange={(e) => { const k = PTT_KEY_CHOICES.find((c) => c.code === Number(e.target.value)); if (k) axi().setPttKey(k) }}>
                  {PTT_KEY_CHOICES.map((k) => <option key={k.code} value={k.code}>{k.name}</option>)}
                </select>
              </label>
              <p className="muted">Binding again may show a KDE confirmation.</p>
```
Sidebar.tsx:32 tooltip → `` `Push to talk armed — hold ${ptt.keyName} to speak` `` (ptt.keyName is on the state slice the Sidebar already receives).

- [ ] **Step 4: Focused, FULL suite, FULL tsc**

All three gates green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/renderer/components/AudioSettings.tsx packages/app/src/renderer/components/Sidebar.tsx packages/app/test/
git commit -m "feat(ptt): dynamic key labels + press-to-bind and dropdown rebind"
```

---

## Self-Review

- **Spec coverage:** key table + settings (T1) ✓; both backends keyed + captureNextKey with Escape/timeout/cleanup (T2, incl. the type-driven index.ts minimum to keep the repo green) ✓; keyName state + setPttKey/capturePttKey with disarm-during-capture and re-arm (T3) ✓; dynamic labels + both rebind UXs + Sidebar tooltip (T4) ✓; defaults/sanitize per spec ✓.
- **Type consistency:** `PttKey` from shared/keys.js everywhere; `bind(id, description, key: PttKey)` uniform across PttController/portal/evdev/selector; `keyName: string` on ptt slice consistent T3/T4; `capturePttKey(): Promise<PttKey | null>` uniform.
- **Placeholder scan:** the Task 2 portal-test note gives the executor an explicit implementation directive (extend fakeBus BindShortcuts recording + exact assertion) rather than finished code — acceptable directed work, everything else is complete code.
- **Gates:** every task mandates focused + FULL suite + FULL tsc (the Task-1-tsc-debt lesson is encoded).
