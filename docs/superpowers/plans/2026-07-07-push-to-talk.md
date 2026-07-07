# Push to Talk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hold F18 → mic audible everywhere (Discord + stream); release → muted everywhere — app-owned PTT via the XDG GlobalShortcuts portal and PipeWire source-level mute.

**Architecture:** A pure `PttController` (injected portal/exec/source deps) owns the lifecycle: enable = bind portal shortcut + mute source; Activated/Deactivated edges = unmute/mute + UI push; disable/boot/quit restore = unmute. A thin `portal-shortcuts.ts` adapter is the only file importing `dbus-next`. Gate command: `pactl set-source-mute <source> 0|1`.

**Tech Stack:** Electron 31 main/preload/renderer, React 18, TypeScript 5.5 (ESM/NodeNext), Vitest 2 (fork pool ≤2), dbus-next (pure JS — no native addon).

## Global Constraints

- 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on all relative imports.
- PTT is best-effort at every layer: never throws out, never blocks boot/go-live/stream.
- The failure mode must always be "mic hot", never "user stranded OS-muted": `disable()`, boot `restore()`, and quit all UNMUTE the source.
- Shortcut id `'ptt'`, description `'Push to talk'`, preferred trigger `'F18'`.
- Source id: the app's `micDevice` verbatim; `'default'`/null → `'@DEFAULT_SOURCE@'`.
- `dbus-next` may ONLY be imported by `packages/app/src/main/portal-shortcuts.ts`.
- UI copy (verbatim requirements): toggle label `Push to talk (hold F18)`; note: `AxiStream mutes your mic at the system level and unmutes it while the key is held. Set Discord to Voice Activity (not Push to Talk) — it follows automatically.`; rebind hint: `Change the key in KDE System Settings → Shortcuts → AxiStream.`; unavailable hint: `Needs the GlobalShortcuts portal — available on KDE Plasma`.
- vitest: `npm -w @axistream/app run test`. Typecheck gate: `cd packages/app && npx tsc --noEmit -p tsconfig.json`.

---

### Task 1: PttController (pure)

**Files:**
- Create: `packages/app/src/main/PttController.ts`
- Test: `packages/app/test/ptt-controller.test.ts`

**Interfaces:**
- Consumes: nothing (all deps injected).
- Produces (later tasks rely on these exact shapes):
```ts
export interface PortalShortcut { onActivated(cb: () => void): void; onDeactivated(cb: () => void): void; close(): Promise<void> }
export interface PortalDeps {
  available(): Promise<boolean>
  bind(id: string, description: string, preferredTrigger: string): Promise<PortalShortcut>
}
export type ExecLike = (cmd: string, args: string[]) => Promise<void>
export interface PttDeps { portal: PortalDeps; exec: ExecLike; sourceId(): string; onActive(active: boolean): void }
export class PttController {
  constructor(d: PttDeps)
  available(): Promise<boolean>
  enable(): Promise<{ ok: boolean; error?: string }>
  disable(): Promise<void>
  restore(): Promise<void>
  isEnabled(): boolean
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/test/ptt-controller.test.ts
import { describe, it, expect, vi } from 'vitest'
import { PttController, type PortalShortcut } from '../src/main/PttController.js'

function harness(opts: { bindError?: string; execError?: boolean; availableResult?: boolean } = {}) {
  let activated: (() => void) | null = null
  let deactivated: (() => void) | null = null
  const shortcut: PortalShortcut = {
    onActivated: (cb) => { activated = cb },
    onDeactivated: (cb) => { deactivated = cb },
    close: vi.fn(async () => {}),
  }
  const mutes: string[] = []
  const actives: boolean[] = []
  const ctl = new PttController({
    portal: {
      available: vi.fn(async () => opts.availableResult ?? true),
      bind: vi.fn(async () => { if (opts.bindError) throw new Error(opts.bindError); return shortcut }),
    },
    exec: vi.fn(async (_cmd, args) => {
      if (opts.execError) throw new Error('pactl failed')
      mutes.push(args.join(' '))
    }),
    sourceId: () => '@DEFAULT_SOURCE@',
    onActive: (a) => actives.push(a),
  })
  return { ctl, shortcut, mutes, actives, press: () => activated?.(), release: () => deactivated?.() }
}

describe('PttController', () => {
  it('enable binds the shortcut then mutes the source (PTT baseline = muted)', async () => {
    const h = harness()
    const r = await h.ctl.enable()
    expect(r).toEqual({ ok: true })
    expect(h.ctl.isEnabled()).toBe(true)
    expect(h.mutes).toEqual(['set-source-mute @DEFAULT_SOURCE@ 1'])
  })

  it('press unmutes + reports active; release mutes + reports inactive', async () => {
    const h = harness()
    await h.ctl.enable()
    h.press()
    await new Promise((r) => setTimeout(r, 0))
    h.release()
    await new Promise((r) => setTimeout(r, 0))
    expect(h.mutes).toEqual([
      'set-source-mute @DEFAULT_SOURCE@ 1',
      'set-source-mute @DEFAULT_SOURCE@ 0',
      'set-source-mute @DEFAULT_SOURCE@ 1',
    ])
    expect(h.actives).toEqual([true, false])
  })

  it('disable closes the shortcut and UNMUTES (never strand the user muted)', async () => {
    const h = harness()
    await h.ctl.enable()
    await h.ctl.disable()
    expect(h.ctl.isEnabled()).toBe(false)
    expect(h.shortcut.close).toHaveBeenCalled()
    expect(h.mutes[h.mutes.length - 1]).toBe('set-source-mute @DEFAULT_SOURCE@ 0')
    expect(h.actives[h.actives.length - 1]).toBe(false)
  })

  it('restore unconditionally unmutes (crash recovery)', async () => {
    const h = harness()
    await h.ctl.restore()
    expect(h.mutes).toEqual(['set-source-mute @DEFAULT_SOURCE@ 0'])
  })

  it('a bind failure returns the error and never touches the source', async () => {
    const h = harness({ bindError: 'portal said no' })
    const r = await h.ctl.enable()
    expect(r.ok).toBe(false)
    expect(r.error).toContain('portal said no')
    expect(h.ctl.isEnabled()).toBe(false)
    expect(h.mutes).toEqual([])
  })

  it('exec failures are swallowed (never throw out)', async () => {
    const h = harness({ execError: true })
    await expect(h.ctl.enable()).resolves.toEqual({ ok: true })
    await expect(h.ctl.disable()).resolves.toBeUndefined()
    await expect(h.ctl.restore()).resolves.toBeUndefined()
  })

  it('enable is a no-op when already enabled; disable when disabled', async () => {
    const h = harness()
    await h.ctl.enable()
    const again = await h.ctl.enable()
    expect(again).toEqual({ ok: true })
    expect(h.mutes.filter((m) => m.endsWith('1'))).toHaveLength(1)
    const fresh = harness()
    await fresh.ctl.disable()
    expect(fresh.mutes).toEqual([])
  })

  it('available() proxies the portal and is false on error', async () => {
    expect(await harness({ availableResult: true }).ctl.available()).toBe(true)
    const h = harness()
    ;(h.ctl as unknown as { d: { portal: { available(): Promise<boolean> } } })
    const broken = new PttController({
      portal: { available: async () => { throw new Error('no bus') }, bind: async () => { throw new Error('x') } },
      exec: async () => {}, sourceId: () => 's', onActive: () => {},
    })
    expect(await broken.available()).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm -w @axistream/app run test -- ptt-controller`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/main/PttController.ts
export interface PortalShortcut { onActivated(cb: () => void): void; onDeactivated(cb: () => void): void; close(): Promise<void> }
export interface PortalDeps {
  available(): Promise<boolean>
  bind(id: string, description: string, preferredTrigger: string): Promise<PortalShortcut>
}
export type ExecLike = (cmd: string, args: string[]) => Promise<void>
export interface PttDeps { portal: PortalDeps; exec: ExecLike; sourceId(): string; onActive(active: boolean): void }

// App-owned push-to-talk: a GlobalShortcuts-portal key gates the mic at the
// PipeWire SOURCE level, so Discord (on voice activity) and the stream both
// follow one mute point. Failure mode is always "mic hot" — disable/restore
// unmute; nothing here may block boot or go-live.
export class PttController {
  private shortcut: PortalShortcut | null = null
  constructor(private readonly d: PttDeps) {}

  isEnabled(): boolean { return this.shortcut !== null }

  async available(): Promise<boolean> {
    try { return await this.d.portal.available() } catch { return false }
  }

  private async setMute(muted: boolean): Promise<void> {
    try { await this.d.exec('pactl', ['set-source-mute', this.d.sourceId(), muted ? '1' : '0']) }
    catch (e) { console.warn('[ptt] set-source-mute failed', e instanceof Error ? e.message : e) }
  }

  async enable(): Promise<{ ok: boolean; error?: string }> {
    if (this.shortcut) return { ok: true }
    let sc: PortalShortcut
    try {
      sc = await this.d.portal.bind('ptt', 'Push to talk', 'F18')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn('[ptt] bind failed', msg)
      return { ok: false, error: msg }
    }
    this.shortcut = sc
    sc.onActivated(() => { void this.setMute(false); this.d.onActive(true) })
    sc.onDeactivated(() => { void this.setMute(true); this.d.onActive(false) })
    await this.setMute(true)
    return { ok: true }
  }

  async disable(): Promise<void> {
    if (!this.shortcut) return
    try { await this.shortcut.close() } catch { /* best-effort */ }
    this.shortcut = null
    await this.setMute(false)
    this.d.onActive(false)
  }

  async restore(): Promise<void> { await this.setMute(false) }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm -w @axistream/app run test -- ptt-controller`
Expected: PASS (8/8).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/PttController.ts packages/app/test/ptt-controller.test.ts
git commit -m "feat(ptt): PttController — portal-gated PipeWire source mute"
```

---

### Task 2: Settings + shared state slice

**Files:**
- Modify: `packages/app/src/main/StreamSettings.ts` (interface + DEFAULT_SETTINGS + sanitize)
- Modify: `packages/app/src/shared/state.ts` (`AppState.ptt`, `INITIAL_STATE.ptt`)
- Test: `packages/app/test/stream-settings.test.ts`
- Possibly touch (ONLY if tsc flags them): test files carrying full `AppState`/settings literals (`stream-screen.test.tsx`, `settings-screen.test.tsx`) — add the new `ptt` field minimally.

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `StreamSettingsData.pttEnabled: boolean` (default `false`); `AppState.ptt: { available: boolean; enabled: boolean; active: boolean; error: string | null }`; `INITIAL_STATE.ptt = { available: false, enabled: false, active: false, error: null }`.

- [ ] **Step 1: Write the failing test**

```ts
// append inside the existing describe in packages/app/test/stream-settings.test.ts
  it('defaults pttEnabled to false, round-trips it, and sanitizes non-booleans', () => {
    const s = new StreamSettings(file)
    expect(s.load().pttEnabled).toBe(false)
    s.patch({ pttEnabled: true })
    expect(new StreamSettings(file).load().pttEnabled).toBe(true)
    s.save({ ...DEFAULT_SETTINGS, pttEnabled: 'yes' as unknown as boolean })
    expect(new StreamSettings(file).load().pttEnabled).toBe(false)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w @axistream/app run test -- stream-settings`
Expected: FAIL — `pttEnabled` undefined.

- [ ] **Step 3: Implement**

`StreamSettings.ts` — add to `StreamSettingsData` (after `discordMessage`): `pttEnabled: boolean`; to `DEFAULT_SETTINGS`: `pttEnabled: false,`; to the load/sanitize object (mirror `preferSoftware` at line ~104):
```ts
        pttEnabled: typeof raw.pttEnabled === 'boolean' ? raw.pttEnabled : DEFAULT_SETTINGS.pttEnabled,
```

`state.ts` — add to `AppState` (after `gameAudioPlugin`):
```ts
  ptt: { available: boolean; enabled: boolean; active: boolean; error: string | null }
```
and to `INITIAL_STATE`:
```ts
  ptt: { available: false, enabled: false, active: false, error: null },
```

- [ ] **Step 4: Run test + full typecheck; fix flagged literals**

Run: `npm -w @axistream/app run test -- stream-settings` → PASS.
Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` — if any test file's full-`AppState` literal errors, add `ptt: { available: false, enabled: false, active: false, error: null },` to that literal (nothing else).
Run: `npm -w @axistream/app run test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/StreamSettings.ts packages/app/src/shared/state.ts packages/app/test/
git commit -m "feat(ptt): pttEnabled setting + AppState.ptt slice"
```

---

### Task 3: portal-shortcuts adapter (dbus-next)

**Files:**
- Modify: `packages/app/package.json` (add dependency)
- Create: `packages/app/src/main/portal-shortcuts.ts`
- Test: `packages/app/test/portal-shortcuts.test.ts` (available()-false-on-error only; the dbus handshake is review-verified — no dbus in the harness)

**Interfaces:**
- Consumes: `PortalDeps`/`PortalShortcut` shapes from Task 1 (structural — do NOT import from PttController; declare the return types to satisfy them).
- Produces: `createPortalShortcuts(busFactory?: () => Promise<PortalBus>): PortalDeps`-compatible object `{ available, bind }` — the only `dbus-next` importer in the codebase.

- [ ] **Step 1: Install the dependency**

Run from the repo root: `npm install -w @axistream/app --save-dev dbus-next`
Expected: `dbus-next` appears in `packages/app/package.json` devDependencies (electron-vite bundles main-process deps; pure JS, no rebuild).

- [ ] **Step 2: Write the failing test**

```ts
// packages/app/test/portal-shortcuts.test.ts
import { describe, it, expect } from 'vitest'
import { createPortalShortcuts } from '../src/main/portal-shortcuts.js'

describe('createPortalShortcuts.available', () => {
  it('is false when the bus cannot be reached (no throw)', async () => {
    const portal = createPortalShortcuts(async () => { throw new Error('no session bus') })
    expect(await portal.available()).toBe(false)
  })

  it('reads the GlobalShortcuts version property when the bus works', async () => {
    const fakeIface = { Get: async () => ({ value: 2 }) }
    const portal = createPortalShortcuts(async () => ({
      getProxyObject: async () => ({ getInterface: () => fakeIface }),
      disconnect: () => {},
    }) as never)
    expect(await portal.available()).toBe(true)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm -w @axistream/app run test -- portal-shortcuts`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement**

```ts
// packages/app/src/main/portal-shortcuts.ts
// The ONLY file that talks dbus. Implements the XDG GlobalShortcuts portal
// handshake (docs: org.freedesktop.portal.GlobalShortcuts, v2):
//   CreateSession -> (Response signal) -> BindShortcuts -> (Response signal)
//   -> Activated / Deactivated signals carry press/release edges.
// Request Response signals arrive on a PREDICTABLE path derived from our
// unique bus name + handle_token, so we proxy that path BEFORE calling the
// method (avoids the classic reply-before-subscribe race).
import dbus, { Variant, type MessageBus, type ClientInterface } from 'dbus-next'

const PORTAL_DEST = 'org.freedesktop.portal.Desktop'
const PORTAL_PATH = '/org/freedesktop/portal/desktop'
const GS_IFACE = 'org.freedesktop.portal.GlobalShortcuts'

export interface BoundShortcut { onActivated(cb: () => void): void; onDeactivated(cb: () => void): void; close(): Promise<void> }

let tokenCounter = 0
const nextToken = () => `axistream_${process.pid}_${++tokenCounter}`

function requestPath(bus: MessageBus, token: string): string {
  // ':1.42' -> '1_42' per the portal spec's sender-path convention.
  const sender = (bus.name ?? '').replace(/^:/, '').replace(/\./g, '_')
  return `/org/freedesktop/portal/desktop/request/${sender}/${token}`
}

async function awaitResponse(bus: MessageBus, token: string, call: () => Promise<unknown>): Promise<Record<string, Variant>> {
  const path = requestPath(bus, token)
  const obj = await bus.getProxyObject(PORTAL_DEST, path)
  const req = obj.getInterface('org.freedesktop.portal.Request')
  const response = new Promise<Record<string, Variant>>((resolve, reject) => {
    req.once('Response', (code: number, results: Record<string, Variant>) => {
      if (code === 0) resolve(results)
      else reject(new Error(`portal request denied (code ${code})`))
    })
  })
  await call()
  return response
}

export function createPortalShortcuts(busFactory: () => Promise<MessageBus> = async () => dbus.sessionBus()) {
  return {
    async available(): Promise<boolean> {
      let bus: MessageBus | null = null
      try {
        bus = await busFactory()
        const obj = await bus.getProxyObject(PORTAL_DEST, PORTAL_PATH)
        const props = obj.getInterface('org.freedesktop.DBus.Properties')
        const v = await props.Get(GS_IFACE, 'version') as Variant
        return Number(v.value) >= 1
      } catch {
        return false
      } finally {
        try { bus?.disconnect() } catch { /* ignore */ }
      }
    },

    async bind(id: string, description: string, preferredTrigger: string): Promise<BoundShortcut> {
      const bus = await busFactory()
      const obj = await bus.getProxyObject(PORTAL_DEST, PORTAL_PATH)
      const gs = obj.getInterface(GS_IFACE) as ClientInterface

      const sessionToken = nextToken()
      const createToken = nextToken()
      const createResults = await awaitResponse(bus, createToken, () => gs.CreateSession({
        handle_token: new Variant('s', createToken),
        session_handle_token: new Variant('s', sessionToken),
      }))
      const sessionHandle = String((createResults.session_handle as Variant).value)

      const bindToken = nextToken()
      await awaitResponse(bus, bindToken, () => gs.BindShortcuts(
        sessionHandle,
        [[id, { description: new Variant('s', description), preferred_trigger: new Variant('s', preferredTrigger) }]],
        '',
        { handle_token: new Variant('s', bindToken) },
      ))

      let onAct: (() => void) | null = null
      let onDeact: (() => void) | null = null
      const activated = (handle: string, shortcutId: string) => {
        if (handle === sessionHandle && shortcutId === id) onAct?.()
      }
      const deactivated = (handle: string, shortcutId: string) => {
        if (handle === sessionHandle && shortcutId === id) onDeact?.()
      }
      gs.on('Activated', activated)
      gs.on('Deactivated', deactivated)

      return {
        onActivated: (cb) => { onAct = cb },
        onDeactivated: (cb) => { onDeact = cb },
        close: async () => {
          gs.removeListener('Activated', activated)
          gs.removeListener('Deactivated', deactivated)
          try {
            const sess = await bus.getProxyObject(PORTAL_DEST, sessionHandle)
            await (sess.getInterface('org.freedesktop.portal.Session') as ClientInterface).Close()
          } catch { /* best-effort */ }
          try { bus.disconnect() } catch { /* ignore */ }
        },
      }
    },
  }
}
```

Note for the implementer: if `dbus-next` lacks bundled types for `MessageBus.name`, use `(bus as unknown as { name?: string }).name` — do not add `@ts-ignore`.

- [ ] **Step 5: Run tests + typecheck**

Run: `npm -w @axistream/app run test -- portal-shortcuts` → PASS.
Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` → zero errors (adjust type casts per the note above if dbus-next's .d.ts differs — keep the runtime code identical).

- [ ] **Step 6: Commit**

```bash
git add packages/app/package.json package-lock.json packages/app/src/main/portal-shortcuts.ts packages/app/test/portal-shortcuts.test.ts
git commit -m "feat(ptt): GlobalShortcuts portal adapter (dbus-next)"
```

---

### Task 4: IPC + index.ts wiring

**Files:**
- Modify: `packages/app/src/shared/state.ts` (CH entry + AxiApi method)
- Modify: `packages/app/src/main/ipc.ts` (Handlers + registration)
- Modify: `packages/app/src/preload/index.ts` (binding)
- Modify: `packages/app/src/main/index.ts` (controller construction, handler, boot probe/restore/re-arm, quit restore)
- No new test file — tsc + full suite + review-verified wiring.

**Interfaces:**
- Consumes: `PttController` (Task 1), `createPortalShortcuts` (Task 3), `pttEnabled` setting + `AppState.ptt` (Task 2).
- Produces: `CH.setPttEnabled = 'axi:setPttEnabled'`; `AxiApi.setPttEnabled(enabled: boolean): Promise<void>`.

- [ ] **Step 1: Channel + AxiApi (state.ts)**

`CH`: `setPttEnabled: 'axi:setPttEnabled',` — `AxiApi`: `setPttEnabled(enabled: boolean): Promise<void>`.

- [ ] **Step 2: ipc.ts + preload**

Handlers: `setPttEnabled(enabled: boolean): Promise<void>`.
Registration: `ipcMain.handle(CH.setPttEnabled, (_e: unknown, enabled: boolean) => handlers.setPttEnabled(enabled))`.
Preload: `setPttEnabled: (enabled) => ipcRenderer.invoke(CH.setPttEnabled, enabled) as Promise<void>,`.

- [ ] **Step 3: index.ts wiring**

Imports:
```ts
import { PttController } from './PttController.js'
import { createPortalShortcuts } from './portal-shortcuts.js'
```
Construction (next to the other controllers, ~line 168). `execFile` is already imported at line 6:
```ts
  const execAsync = (cmd: string, args: string[]) => new Promise<void>((resolve, reject) => {
    execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
  })
  const ptt = new PttController({
    portal: createPortalShortcuts(),
    exec: execAsync,
    sourceId: () => {
      const dev = settings.load().micDevice
      return dev && dev !== 'default' ? dev : '@DEFAULT_SOURCE@'
    },
    onActive: (active) => setState({ ptt: { ...state.ptt, active } }),
  })
```
Handler (near the other audio handlers):
```ts
    setPttEnabled: async (enabled) => {
      settings.patch({ pttEnabled: enabled })
      if (enabled) {
        const r = await ptt.enable()
        setState({ ptt: { ...state.ptt, enabled: r.ok, active: false, error: r.ok ? null : (r.error ?? 'failed') } })
      } else {
        await ptt.disable()
        setState({ ptt: { ...state.ptt, enabled: false, active: false, error: null } })
      }
    },
```
Boot (in the `provisioned` branch, right after the audio `applySettings` line ~491):
```ts
      // PTT: crash recovery first (a previous run may have died source-muted),
      // then probe the portal and re-arm if the user had it on.
      await ptt.restore()
      const pttAvailable = await ptt.available()
      setState({ ptt: { ...state.ptt, available: pttAvailable } })
      if (pttAvailable && a.pttEnabled) {
        const r = await ptt.enable()
        setState({ ptt: { ...state.ptt, enabled: r.ok, error: r.ok ? null : (r.error ?? 'failed') } })
      }
```
Quit — inside the existing `win.on('close', …)` teardown (before `sidecar.stop()`):
```ts
    if (ptt.isEnabled()) void ptt.restore()
```

- [ ] **Step 4: Typecheck + full suite**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` → zero errors.
Run: `npm -w @axistream/app run test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/main/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/index.ts
git commit -m "feat(ptt): setPttEnabled IPC + boot restore/probe/re-arm + quit restore"
```

---

### Task 5: AudioSettings UI

**Files:**
- Modify: `packages/app/src/renderer/components/AudioSettings.tsx` (new `ptt` prop + PTT block)
- Modify: `packages/app/src/renderer/components/SettingsScreen.tsx` (pass `ptt={state.ptt}`)
- Modify: `packages/app/src/renderer/styles.css`
- Test: `packages/app/test/audio-settings.test.tsx`

**Interfaces:**
- Consumes: `AppState['ptt']` (Task 2), `axi().setPttEnabled` (Task 4), existing `audio.micEnabled`.
- Produces: `AudioSettings` gains a required prop `ptt: AppState['ptt']`.

- [ ] **Step 1: Write the failing tests**

Update the axi mock (add `setPttEnabled: vi.fn(async () => {})`). `AudioSettings` gains the `ptt` prop — add `ptt={pttOff}` to every existing `render(<AudioSettings …/>)` call with `const pttOff = { available: true, enabled: false, active: false, error: null }` declared near `pluginReady`. New tests:

```ts
  it('PTT row hidden when the mic is off; visible when on', async () => {
    const base = { desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }
    const { rerender } = render(<AudioSettings audio={base} gameAudioPlugin={pluginReady} phase="READY" ptt={pttOff} />)
    expect(screen.queryByLabelText(/push to talk/i)).not.toBeInTheDocument()
    rerender(<AudioSettings audio={{ ...base, micEnabled: true }} gameAudioPlugin={pluginReady} phase="READY" ptt={pttOff} />)
    expect(screen.getByLabelText(/push to talk/i)).toBeInTheDocument()
  })

  it('toggling PTT calls setPttEnabled and shows the Discord note', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={pttOff} />)
    fireEvent.click(screen.getByLabelText(/push to talk/i))
    expect(axi.setPttEnabled).toHaveBeenCalledWith(true)
    expect(screen.getByText(/voice activity/i)).toBeInTheDocument()
  })

  it('shows TRANSMITTING while active and the portal-missing hint when unavailable', async () => {
    const audio = { desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }
    const { rerender } = render(<AudioSettings audio={audio} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: true, enabled: true, active: true, error: null }} />)
    expect(screen.getByText(/transmitting/i)).toBeInTheDocument()
    rerender(<AudioSettings audio={audio} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: false, enabled: false, active: false, error: null }} />)
    expect(screen.getByLabelText(/push to talk/i)).toBeDisabled()
    expect(screen.getByText(/GlobalShortcuts portal/i)).toBeInTheDocument()
  })

  it('surfaces a PTT error', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: true, enabled: false, active: false, error: 'portal request denied (code 1)' }} />)
    expect(screen.getByText(/portal request denied/i)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm -w @axistream/app run test -- audio-settings`
Expected: FAIL — missing prop / no PTT row.

- [ ] **Step 3: Implement**

`AudioSettings.tsx` — extend the signature:
```ts
export function AudioSettings({ audio, gameAudioPlugin, phase, ptt }: { audio: AppState['audio']; gameAudioPlugin: AppState['gameAudioPlugin']; phase: AppState['phase']; ptt: AppState['ptt'] }) {
```
Add after the mic-device block (before the audio-test block):
```tsx
      {audio.micEnabled && (
        <div className="ptt">
          <label className="audio-row">
            <input type="checkbox" checked={ptt.enabled} disabled={!ptt.available} aria-label="Push to talk (hold F18)"
              onChange={(e) => axi().setPttEnabled(e.target.checked)} />
            <span>Push to talk (hold F18)</span>
            {ptt.enabled && (ptt.active
              ? <span className="ptt-live">🔴 TRANSMITTING</span>
              : <span className="ptt-muted">muted — hold F18 to talk</span>)}
          </label>
          {!ptt.available && <p className="muted">Needs the GlobalShortcuts portal — available on KDE Plasma</p>}
          {ptt.error && <p className="ptt-err">{ptt.error}</p>}
          {ptt.enabled && (
            <p className="muted">AxiStream mutes your mic at the system level and unmutes it while the key is held. Set Discord to <strong>Voice Activity</strong> (not Push to Talk) — it follows automatically.</p>
          )}
          {ptt.enabled && <p className="muted">Change the key in KDE System Settings → Shortcuts → AxiStream.</p>}
        </div>
      )}
```
`SettingsScreen.tsx` — pass the prop: `<AudioSettings audio={state.audio} gameAudioPlugin={state.gameAudioPlugin} phase={state.phase} ptt={state.ptt} />`.
`styles.css` — near the audio styles:
```css
/* Push to talk */
.ptt { border-top: 1px solid rgba(255,255,255,.08); margin-top: 14px; padding-top: 10px; }
.ptt-live { margin-left: auto; font-size: 11px; font-weight: 800; color: #f85149; letter-spacing: .04em; }
.ptt-muted { margin-left: auto; font-size: 11px; color: #8b98a5; }
.ptt-err { font-size: 12px; font-weight: 600; color: #f85149; }
```

- [ ] **Step 4: Run tests, full suite, typecheck**

Run: `npm -w @axistream/app run test -- audio-settings` → PASS.
Run: `npm -w @axistream/app run test` → all pass.
Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` → zero errors.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/renderer/components/AudioSettings.tsx packages/app/src/renderer/components/SettingsScreen.tsx packages/app/src/renderer/styles.css packages/app/test/audio-settings.test.tsx
git commit -m "feat(ptt): settings UI — toggle, TRANSMITTING pill, Discord note"
```

---

## Self-Review

- **Spec coverage:** PttController lifecycle + edges + safety rails (Task 1) ✓; `pttEnabled` + `AppState.ptt` incl. `error` (Task 2) ✓; portal adapter, dbus-next isolation, CreateSession/BindShortcuts/signals, close (Task 3) ✓; IPC + boot restore/probe/re-arm + quit restore (Task 4) ✓; UI toggle/pill/notes/hints with verbatim copy (Task 5) ✓; non-goals untouched.
- **Type consistency:** `PortalShortcut`/`PortalDeps` shapes in Task 1 are satisfied structurally by Task 3's `createPortalShortcuts` return (`bind` returns `BoundShortcut` ≡ `PortalShortcut`); `AppState['ptt']` field set identical across Tasks 2/4/5; `setPttEnabled(enabled: boolean)` consistent across CH/AxiApi/Handlers/preload/UI.
- **Placeholder scan:** none — every step carries complete code.
- **Risk note (for the final review, not a task):** the dbus handshake in Task 3 is the one piece unit tests can't cover — the manual smoke (enable → KDE binds F18 → hold to talk in Discord) is the real gate, same as every OBS-facing feature.
