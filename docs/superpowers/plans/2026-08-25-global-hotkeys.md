# Global Hotkeys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make go live / end stream, mic mute, mask visibility, and recording bindable to global hotkeys on Linux and Windows, without regressing push-to-talk.

**Architecture:** A single `HotkeyService` in the main process owns every global binding — push-to-talk's included — and multiplexes them onto **one watcher per backend** via a new `bindAll` batch call. The three existing backends (XDG GlobalShortcuts portal, evdev poller, Windows `GetAsyncKeyState` poller) grow `bindAll`; `bind` becomes a one-element wrapper during the transition and is deleted once `PttController` consumes the service.

**Tech Stack:** Electron 31, React 18, TypeScript (ESM/NodeNext), vitest + @testing-library/react, dbus-next, koffi.

**Spec:** `docs/superpowers/specs/2026-08-25-global-hotkeys-design.md`

## Global Constraints

- Code style: 2-space indent, **no semicolons**, single quotes, named exports, `.js` extensions on relative imports. No linter is configured.
- Nothing on the hotkey path may block or delay go-live. Toast dispatch is fire-and-forget.
- A hotkey handler that throws must never escape — these callbacks run outside any request context, so an unhandled rejection surfaces as a crash with no renderer to report it.
- OBS calls stay best-effort (`console.warn`, never throw out).
- **Nothing is bound by default.** Every action's default binding is `null`.
- **A malformed persisted hotkey entry falls back to `null`, never to a key.** A corrupted settings file must not silently grab a key away from the game.
- **Boundary rule:** persisted bindings store an absent modifier as `''`; every in-memory `Binding` uses `null`. Conversion happens once, at the `StreamSettings` load/patch boundary. Nothing above that layer sees `''`.
- **Regression signal:** the existing push-to-talk tests must pass essentially unchanged. If they need rewriting, push-to-talk's behavior changed and something is wrong.
- Gates before merge: `npm -w @axistream/app run test`, `npm -w @axistream/capture run test`, `cd packages/app && npx tsc --noEmit -p tsconfig.json`.
- Run vitest with the repo's configured fork pool (capped at 2 workers). Do not raise it.

## File Structure

**Create:**
- `packages/app/src/shared/hotkeys.ts` — action registry: ids, labels, `Binding`, `PersistedBinding`, persisted↔memory conversion, conflict detection. Pure; no imports from `main/` or `renderer/`.
- `packages/app/src/main/HotkeyService.ts` — owns the single backend session, dispatches ids to injected action callbacks, holds the end-stream confirmation window.
- `packages/app/src/renderer/components/HotkeySettings.tsx` — the Settings section.
- `packages/app/src/renderer/components/KeyPicker.tsx` — renamed from `PttKeyPicker.tsx`, extended to accept a nullable binding.
- Tests: `packages/app/test/hotkeys.test.ts`, `packages/app/test/HotkeyService.test.ts`, `packages/app/test/hotkey-settings.test.tsx`.

**Modify:**
- `packages/app/src/main/portal-shortcuts.ts` — add `bindAll`.
- `packages/app/src/main/evdev-keys.ts` — add `bindAll`.
- `packages/app/src/main/windows-keys.ts` — add `bindAll`.
- `packages/app/src/main/PttController.ts` — consume the shared service instead of binding.
- `packages/app/src/main/StreamSettings.ts` — persist and validate the `hotkeys` record.
- `packages/app/src/shared/state.ts` — `hotkeys` state slice, `CH.setHotkey`, `AxiApi.setHotkey`.
- `packages/app/src/main/ipc.ts`, `packages/app/src/preload/index.ts` — the `setHotkey` channel.
- `packages/app/src/main/index.ts` — wiring.
- `packages/app/src/renderer/components/SettingsScreen.tsx` — mount the section.
- `packages/app/src/renderer/components/AudioSettings.tsx` — update the `PttKeyPicker` import to `KeyPicker`.

---

### Task 1: Shared hotkey registry

**Files:**
- Create: `packages/app/src/shared/hotkeys.ts`
- Test: `packages/app/test/hotkeys.test.ts`

**Interfaces:**
- Consumes: `PttKey`, `PttModifier`, `PttBinding` from `packages/app/src/shared/keys.ts`.
- Produces: `HotkeyId`, `HOTKEY_IDS`, `HOTKEY_LABELS`, `HOTKEY_DESCRIPTIONS`, `Binding`, `PersistedBinding`, `HotkeyBindings`, `PersistedHotkeys`, `DEFAULT_HOTKEYS`, `BindSpec`, `BoundSet`, `HotkeyBackend`, `toBinding`, `toPersisted`, `findConflict`.

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/hotkeys.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  HOTKEY_IDS, HOTKEY_LABELS, DEFAULT_HOTKEYS,
  toBinding, toPersisted, findConflict,
} from '../src/shared/hotkeys.js'

const F13 = { code: 183, name: 'F13' }
const F14 = { code: 184, name: 'F14' }

describe('hotkey registry', () => {
  it('exposes exactly the four spec actions, in a stable order', () => {
    expect(HOTKEY_IDS).toEqual(['goLive', 'micMute', 'masks', 'record'])
  })

  it('labels every id', () => {
    for (const id of HOTKEY_IDS) expect(HOTKEY_LABELS[id]).toBeTruthy()
  })

  it('defaults every action to unbound', () => {
    for (const id of HOTKEY_IDS) expect(DEFAULT_HOTKEYS[id]).toBeNull()
  })
})

describe('toBinding', () => {
  it("converts the persisted empty-string modifier to null", () => {
    expect(toBinding({ code: 183, name: 'F13', modifier: '' }))
      .toEqual({ key: F13, modifier: null })
  })

  it('preserves a real modifier', () => {
    expect(toBinding({ code: 183, name: 'F13', modifier: 'ctrl' }))
      .toEqual({ key: F13, modifier: 'ctrl' })
  })

  it('passes null through', () => {
    expect(toBinding(null)).toBeNull()
  })
})

describe('toPersisted', () => {
  it("converts a null modifier to the empty string", () => {
    expect(toPersisted({ key: F13, modifier: null }))
      .toEqual({ code: 183, name: 'F13', modifier: '' })
  })

  it('round-trips through toBinding', () => {
    const b = { key: F14, modifier: 'alt' as const }
    expect(toBinding(toPersisted(b))).toEqual(b)
  })

  it('passes null through', () => {
    expect(toPersisted(null)).toBeNull()
  })
})

describe('findConflict', () => {
  const bindings = {
    goLive: { key: F13, modifier: null },
    micMute: null,
    masks: null,
    record: null,
  }
  const ptt = { key: F14, modifier: null }

  it('names the action already holding the key', () => {
    expect(findConflict('masks', { key: F13, modifier: null }, bindings, ptt))
      .toBe(HOTKEY_LABELS.goLive)
  })

  it('names push-to-talk when the key is its binding', () => {
    expect(findConflict('masks', { key: F14, modifier: null }, bindings, ptt))
      .toBe('Push to talk')
  })

  it('allows rebinding an action to the key it already holds', () => {
    expect(findConflict('goLive', { key: F13, modifier: null }, bindings, ptt)).toBeNull()
  })

  it('treats a differing modifier as a different binding', () => {
    expect(findConflict('masks', { key: F13, modifier: 'ctrl' }, bindings, ptt)).toBeNull()
  })

  it('returns null when nothing holds the key', () => {
    expect(findConflict('masks', { key: { code: 185, name: 'F15' }, modifier: null }, bindings, ptt))
      .toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @axistream/app run test -- hotkeys.test.ts`
Expected: FAIL — cannot resolve `../src/shared/hotkeys.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/app/src/shared/hotkeys.ts`:

```ts
// packages/app/src/shared/hotkeys.ts
// The action registry for global hotkeys. Pure data plus pure functions —
// imported by main, preload, and renderer alike, so nothing here may touch
// node, electron, or DOM APIs.
import type { PttBinding, PttKey, PttModifier } from './keys.js'

export type HotkeyId = 'goLive' | 'micMute' | 'masks' | 'record'

/** Stable order — the Settings rows render in exactly this sequence. */
export const HOTKEY_IDS: HotkeyId[] = ['goLive', 'micMute', 'masks', 'record']

export const HOTKEY_LABELS: Record<HotkeyId, string> = {
  goLive: 'Go live / End stream',
  micMute: 'Mic mute',
  masks: 'Masks',
  record: 'Record',
}

/** Shown to the user by the portal's own shortcut UI (KDE lists these in its
 *  approval dialog and its global-shortcuts settings page). */
export const HOTKEY_DESCRIPTIONS: Record<HotkeyId, string> = {
  goLive: 'Start streaming, or end the stream',
  micMute: 'Mute or unmute the microphone',
  masks: 'Show or hide privacy masks',
  record: 'Start or stop a local recording',
}

/** In-memory binding. Structurally identical to PttBinding on purpose: that is
 *  what lets one backend call carry push-to-talk and the four actions in the
 *  same array. */
export interface Binding { key: PttKey; modifier: PttModifier | null }

/** On-disk binding. The empty-string modifier follows push-to-talk's existing
 *  settings convention — see toBinding/toPersisted for the boundary. */
export interface PersistedBinding {
  code: number
  name: string
  modifier: '' | PttModifier
}

/** The contract every backend implements. Declared here, once, so the three
 *  backends and HotkeyService cannot drift apart. `id` is a plain string
 *  because the push-to-talk slot ('ptt') is not a HotkeyId. */
export interface BindSpec { id: string; description: string; binding: Binding }
export interface BoundSet {
  onActivated(cb: (id: string) => void): void
  onDeactivated(cb: (id: string) => void): void
  close(): Promise<void>
}
export interface HotkeyBackend {
  available(): Promise<boolean>
  bindAll(specs: BindSpec[]): Promise<BoundSet>
}

export type HotkeyBindings = Record<HotkeyId, Binding | null>
export type PersistedHotkeys = Record<HotkeyId, PersistedBinding | null>

/** Nothing is bound out of the box: any default risks silently taking a key
 *  away from Guild Wars 2, and on the portal backend the user has no way to
 *  connect a dead skill key back to AxiStream. */
export const DEFAULT_HOTKEYS: PersistedHotkeys = {
  goLive: null, micMute: null, masks: null, record: null,
}

export function toBinding(p: PersistedBinding | null): Binding | null {
  if (!p) return null
  return { key: { code: p.code, name: p.name }, modifier: p.modifier === '' ? null : p.modifier }
}

export function toPersisted(b: Binding | null): PersistedBinding | null {
  if (!b) return null
  return { code: b.key.code, name: b.key.name, modifier: b.modifier ?? '' }
}

const sameBinding = (a: Binding, b: Binding) => a.key.code === b.key.code && a.modifier === b.modifier

/** The label of whatever already holds this key, or null if it is free.
 *  Rebinding an action to the key it already holds is not a conflict. */
export function findConflict(
  id: HotkeyId,
  binding: Binding,
  bindings: HotkeyBindings,
  ptt: PttBinding | null,
): string | null {
  for (const other of HOTKEY_IDS) {
    if (other === id) continue
    const held = bindings[other]
    if (held && sameBinding(held, binding)) return HOTKEY_LABELS[other]
  }
  if (ptt && sameBinding(ptt, binding)) return 'Push to talk'
  return null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm -w @axistream/app run test -- hotkeys.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..
git add packages/app/src/shared/hotkeys.ts packages/app/test/hotkeys.test.ts
git commit -m "feat(hotkeys): shared action registry, binding conversion, conflict detection"
```

---

### Task 2: Persist the hotkey bindings

**Files:**
- Modify: `packages/app/src/main/StreamSettings.ts`
- Test: `packages/app/test/stream-settings.test.ts`

**Interfaces:**
- Consumes: `PersistedHotkeys`, `DEFAULT_HOTKEYS` from `../shared/hotkeys.js`.
- Produces: a `hotkeys: PersistedHotkeys` field on the settings object, valid after `load()`.

- [ ] **Step 1: Write the failing test**

Append to `packages/app/test/stream-settings.test.ts` (follow the file's existing helper for writing a settings file and constructing the store — reuse whatever fixture the neighbouring tests use rather than inventing a new one):

```ts
describe('hotkeys persistence', () => {
  it('defaults every action to unbound', () => {
    const s = loadWith({})
    expect(s.hotkeys).toEqual({ goLive: null, micMute: null, masks: null, record: null })
  })

  it('round-trips a valid binding', () => {
    const s = loadWith({ hotkeys: { goLive: { code: 183, name: 'F13', modifier: 'ctrl' }, micMute: null, masks: null, record: null } })
    expect(s.hotkeys.goLive).toEqual({ code: 183, name: 'F13', modifier: 'ctrl' })
  })

  it('drops a malformed entry to null rather than to a key', () => {
    const s = loadWith({ hotkeys: { goLive: { code: 'nope', name: 'F13', modifier: '' }, micMute: null, masks: null, record: null } })
    expect(s.hotkeys.goLive).toBeNull()
  })

  it('drops an out-of-range keycode to null', () => {
    const s = loadWith({ hotkeys: { goLive: { code: 9999, name: 'X', modifier: '' }, micMute: null, masks: null, record: null } })
    expect(s.hotkeys.goLive).toBeNull()
  })

  it('drops an unknown modifier to null', () => {
    const s = loadWith({ hotkeys: { goLive: { code: 183, name: 'F13', modifier: 'hyper' }, micMute: null, masks: null, record: null } })
    expect(s.hotkeys.goLive).toBeNull()
  })

  it('survives hotkeys being a non-object', () => {
    const s = loadWith({ hotkeys: 'yes' })
    expect(s.hotkeys).toEqual({ goLive: null, micMute: null, masks: null, record: null })
  })

  it('fills in a missing action key', () => {
    const s = loadWith({ hotkeys: { goLive: { code: 183, name: 'F13', modifier: '' } } })
    expect(s.hotkeys.record).toBeNull()
  })
})
```

If `stream-settings.test.ts` has no `loadWith` helper, add one at the top of the new `describe` that writes the given object as JSON to the temp settings path the other tests use and returns `settings.load()`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @axistream/app run test -- stream-settings.test.ts`
Expected: FAIL — `s.hotkeys` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `StreamSettings.ts`, add the import and the field to the settings interface and `DEFAULT_SETTINGS`:

```ts
import { DEFAULT_HOTKEYS, HOTKEY_IDS, type PersistedBinding, type PersistedHotkeys } from '../shared/hotkeys.js'
```

Interface field:

```ts
  hotkeys: PersistedHotkeys
```

Default:

```ts
  hotkeys: DEFAULT_HOTKEYS,
```

Add the validator above the `load()` body:

```ts
const MODIFIERS = ['ctrl', 'alt', 'shift', 'super']

/** A malformed entry becomes null (unbound), never a fallback key: a corrupted
 *  settings file must not silently grab a key away from the game. */
function validBinding(raw: unknown): PersistedBinding | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Number.isInteger(r.code) || (r.code as number) < 1 || (r.code as number) > 767) return null
  if (typeof r.name !== 'string' || !r.name) return null
  if (r.modifier !== '' && !MODIFIERS.includes(r.modifier as string)) return null
  return { code: r.code as number, name: r.name, modifier: r.modifier as PersistedBinding['modifier'] }
}

function validHotkeys(raw: unknown): PersistedHotkeys {
  const src = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  const out = {} as PersistedHotkeys
  for (const id of HOTKEY_IDS) out[id] = validBinding(src[id])
  return out
}
```

And in the object `load()` returns, alongside the `ptt*` lines:

```ts
        hotkeys: validHotkeys(raw.hotkeys),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm -w @axistream/app run test -- stream-settings.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Typecheck and commit**

```bash
cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..
git add packages/app/src/main/StreamSettings.ts packages/app/test/stream-settings.test.ts
git commit -m "feat(settings): persist hotkey bindings, defaulting every action to unbound"
```

---

### Task 3: Give all three backends a `bindAll`

**Files:**
- Modify: `packages/app/src/main/portal-shortcuts.ts`, `packages/app/src/main/evdev-keys.ts`, `packages/app/src/main/windows-keys.ts`
- Test: `packages/app/test/evdev-keys.test.ts`, `packages/app/test/windows-keys.test.ts`, `packages/app/test/portal-shortcuts.test.ts`

**Interfaces:**
- Consumes: `Binding`, `BindSpec`, `BoundSet` from `../shared/hotkeys.js` (Task 1). Import these — do **not** re-declare them in the backend files.
- Produces, on all three backend factories:

```ts
bindAll(specs: BindSpec[]): Promise<BoundSet>
```

**This task must not change any observable push-to-talk behavior.** Keep the existing `bind(id, description, binding)` on each backend, reimplemented as a one-element `bindAll` wrapper, so `PttController` and every existing test stay green. Task 6 deletes the wrapper.

- [ ] **Step 1: Write the failing evdev test**

Append to `packages/app/test/evdev-keys.test.ts`, reusing the file's existing fake-deps helpers (`listDevices` / `canRead` / `openStream` and whatever it uses to push synthetic `input_event` frames):

```ts
describe('evdev bindAll', () => {
  it('dispatches two different keys to their own ids from ONE pass over the devices', async () => {
    const deps = fakeDeps(['/dev/input/event0'])
    const set = await createEvdevShortcuts(deps).bindAll([
      { id: 'ptt', description: 'Push to talk', binding: { key: { code: 188, name: 'F18' }, modifier: null } },
      { id: 'masks', description: 'Masks', binding: { key: { code: 183, name: 'F13' }, modifier: null } },
    ])
    const fired: string[] = []
    set.onActivated((id) => fired.push(id))

    deps.emit('/dev/input/event0', { type: 1, code: 183, value: 1 })
    deps.emit('/dev/input/event0', { type: 1, code: 188, value: 1 })

    expect(fired).toEqual(['masks', 'ptt'])
    // One watcher, not one per spec: the whole point of the batch call.
    expect(deps.openStream).toHaveBeenCalledTimes(1)
    await set.close()
  })

  it('reports release edges with the id that pressed', async () => {
    const deps = fakeDeps(['/dev/input/event0'])
    const set = await createEvdevShortcuts(deps).bindAll([
      { id: 'ptt', description: 'Push to talk', binding: { key: { code: 188, name: 'F18' }, modifier: null } },
    ])
    const down: string[] = []
    const up: string[] = []
    set.onActivated((id) => down.push(id))
    set.onDeactivated((id) => up.push(id))

    deps.emit('/dev/input/event0', { type: 1, code: 188, value: 1 })
    deps.emit('/dev/input/event0', { type: 1, code: 188, value: 0 })

    expect(down).toEqual(['ptt'])
    expect(up).toEqual(['ptt'])
    await set.close()
  })

  it('gates a modified spec on its modifier while leaving an unmodified one alone', async () => {
    const deps = fakeDeps(['/dev/input/event0'])
    const set = await createEvdevShortcuts(deps).bindAll([
      { id: 'masks', description: 'Masks', binding: { key: { code: 183, name: 'F13' }, modifier: 'ctrl' } },
      { id: 'record', description: 'Record', binding: { key: { code: 183, name: 'F13' }, modifier: null } },
    ])
    const fired: string[] = []
    set.onActivated((id) => fired.push(id))

    // F13 with no Ctrl held: only the unmodified spec fires.
    deps.emit('/dev/input/event0', { type: 1, code: 183, value: 1 })
    deps.emit('/dev/input/event0', { type: 1, code: 183, value: 0 })
    expect(fired).toEqual(['record'])

    // Ctrl down, then F13: both specs match now.
    fired.length = 0
    deps.emit('/dev/input/event0', { type: 1, code: 29, value: 1 })
    deps.emit('/dev/input/event0', { type: 1, code: 183, value: 1 })
    expect(fired).toEqual(['masks', 'record'])
    await set.close()
  })

  it('ignores auto-repeat (value 2)', async () => {
    const deps = fakeDeps(['/dev/input/event0'])
    const set = await createEvdevShortcuts(deps).bindAll([
      { id: 'masks', description: 'Masks', binding: { key: { code: 183, name: 'F13' }, modifier: null } },
    ])
    const fired: string[] = []
    set.onActivated((id) => fired.push(id))

    deps.emit('/dev/input/event0', { type: 1, code: 183, value: 1 })
    deps.emit('/dev/input/event0', { type: 1, code: 183, value: 2 })
    deps.emit('/dev/input/event0', { type: 1, code: 183, value: 2 })

    expect(fired).toEqual(['masks'])
    await set.close()
  })
})
```

If the existing file has no `fakeDeps` helper of this shape, write one in the new `describe` that records `openStream` calls with `vi.fn()`, keeps the registered `data` callbacks per path, and exposes `emit(path, event)` which encodes the event into a 24-byte `input_event` buffer (16 bytes timeval, `u16` type at offset 16, `u16` code at 18, `s32` value at 20, little-endian) and hands it to that path's callback.

- [ ] **Step 2: Run the evdev test to verify it fails**

Run: `npm -w @axistream/app run test -- evdev-keys.test.ts`
Expected: FAIL — `bindAll is not a function`.

- [ ] **Step 3: Implement evdev `bindAll`**

Replace the body of `createEvdevShortcuts` with a `bindAll` that opens the device streams **once** and dispatches per spec. Each spec keeps its own `active` flag; the modifier-held flags are shared across all streams exactly as today (the modifier can come from the keyboard while the key comes from the mouse):

```ts
import type { BindSpec, Binding, BoundSet } from '../shared/hotkeys.js'

export function createEvdevShortcuts(deps: EvdevDeps = realDeps) {
  const self = {
    async available(): Promise<boolean> {
      return deps.listDevices().some((d) => deps.canRead(d))
    },

    async bindAll(specs: BindSpec[]): Promise<BoundSet> {
      const readable = deps.listDevices().filter((d) => deps.canRead(d))
      if (readable.length === 0) throw new Error('no readable input devices — pass-through is locked')

      let onAct: ((id: string) => void) | null = null
      let onDeact: ((id: string) => void) | null = null

      // Per-spec arm state; shared modifier state. A modifier already held
      // before arming isn't seen until its next edge (accepted: worst case is
      // one missed activation) — same trade-off the single-bind path made.
      const watches = specs.map((s) => ({
        id: s.id,
        code: s.binding.key.code,
        modCodes: s.binding.modifier ? MODIFIER_CODES[s.binding.modifier] : null,
        active: false,
      }))
      const modifierHeld = new Set<number>()

      const streams = new Set<ReturnType<EvdevDeps['openStream']>>()
      readable.forEach((path) => {
        const stream = deps.openStream(path)
        streams.add(stream)
        let rest: Buffer = Buffer.alloc(0)
        stream.on('data', ((chunk: Buffer) => {
          const parsed = parseInputEvents(rest.length === 0 ? chunk : Buffer.concat([rest, chunk]))
          rest = parsed.rest
          for (const ev of parsed.events) {
            if (ev.type !== EV_KEY) continue

            // A code can be BOTH somebody's modifier and somebody's key, so
            // modifier bookkeeping happens first and does not `continue` past
            // the key matching below.
            if (ev.value === 1) modifierHeld.add(ev.code)
            else if (ev.value === 0) modifierHeld.delete(ev.code)

            for (const w of watches) {
              const modOk = !w.modCodes || w.modCodes.some((c) => modifierHeld.has(c))
              if (w.modCodes && w.active && !modOk) {
                // The modifier was released while the key is still down.
                w.active = false
                onDeact?.(w.id)
              }
              if (ev.code !== w.code) continue
              if (ev.value === 1) {
                if (modOk && !w.active) { w.active = true; onAct?.(w.id) }
              } else if (ev.value === 0) {
                if (w.active) { w.active = false; onDeact?.(w.id) }
              }
              // value 2 = auto-repeat: ignored (the key is already down)
            }
          }
        }) as never)
        stream.on('error', ((e: Error) => {
          console.warn(`[hotkeys] evdev device dropped (${path}):`, e.message)
          streams.delete(stream)
          try { stream.destroy() } catch { /* ignore */ }
        }) as never)
      })

      return {
        onActivated: (cb) => { onAct = cb },
        onDeactivated: (cb) => { onDeact = cb },
        close: async () => { for (const s of streams) { try { s.destroy() } catch { /* ignore */ } } },
      }
    },

    /** Transitional single-shortcut wrapper — Task 6 deletes this once
     *  PttController consumes HotkeyService. */
    async bind(id: string, description: string, binding: PttBinding): Promise<BoundShortcut> {
      const set = await self.bindAll([{ id, description, binding }])
      return {
        onActivated: (cb) => set.onActivated(() => cb()),
        onDeactivated: (cb) => set.onDeactivated(() => cb()),
        close: () => set.close(),
      }
    },
  }
  return self
}
```

- [ ] **Step 4: Run the evdev tests to verify they pass**

Run: `npm -w @axistream/app run test -- evdev-keys.test.ts`
Expected: PASS, including every pre-existing test in the file unchanged.

- [ ] **Step 5: Write the failing Windows test**

Append to `packages/app/test/windows-keys.test.ts`, using the file's existing injected `keyDown` fake and fake timers:

```ts
describe('windows bindAll', () => {
  it('watches every bound VK from ONE timer and dispatches by id', async () => {
    vi.useFakeTimers()
    const down = new Set<number>()
    const deps = { platform: 'win32' as const, keyDown: (vk: number) => down.has(vk) }
    const set = await createWindowsKeys(deps).bindAll([
      { id: 'ptt', description: 'Push to talk', binding: { key: { code: 188, name: 'F18' }, modifier: null } },
      { id: 'masks', description: 'Masks', binding: { key: { code: 183, name: 'F13' }, modifier: null } },
    ])
    const fired: string[] = []
    set.onActivated((id) => fired.push(id))

    down.add(0x7C) // F13
    vi.advanceTimersByTime(30)
    expect(fired).toEqual(['masks'])

    down.add(0x87) // F18
    vi.advanceTimersByTime(30)
    expect(fired).toEqual(['masks', 'ptt'])

    await set.close()
    vi.useRealTimers()
  })

  it('skips a spec whose key has no Windows equivalent instead of failing the whole set', async () => {
    vi.useFakeTimers()
    const deps = { platform: 'win32' as const, keyDown: () => false }
    const set = await createWindowsKeys(deps).bindAll([
      { id: 'masks', description: 'Masks', binding: { key: { code: 999, name: 'KEY_999' }, modifier: null } },
      { id: 'record', description: 'Record', binding: { key: { code: 183, name: 'F13' }, modifier: null } },
    ])
    // No throw: the unsupported spec is dropped with a warning, the rest arm.
    await set.close()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 6: Implement Windows `bindAll`**

Same shape: one `setInterval`, a per-spec `{ id, keyVk, modVks, keyWasDown, active }` record seeded from `deps.keyDown(keyVk)` as today. A spec whose `evdevToVk` returns `null` is **dropped with a `console.warn`** rather than throwing — one unsupported key must not disarm the other three actions. Keep the existing `bind` wrapper, but preserve its current throwing behavior for the unsupported-key case so the push-to-talk tests that assert the throw stay green:

```ts
    async bind(id: string, description: string, binding: PttBinding): Promise<BoundShortcut> {
      if (evdevToVk(binding.key.code) === null) {
        throw new Error(`key not supported on Windows: ${keyName(binding.key.code)}`)
      }
      const set = await self.bindAll([{ id, description, binding }])
      return {
        onActivated: (cb) => set.onActivated(() => cb()),
        onDeactivated: (cb) => set.onDeactivated(() => cb()),
        close: () => set.close(),
      }
    },
```

- [ ] **Step 7: Run the Windows tests**

Run: `npm -w @axistream/app run test -- windows-keys.test.ts`
Expected: PASS, pre-existing tests unchanged.

- [ ] **Step 8: Write the failing portal test**

Append to `packages/app/test/portal-shortcuts.test.ts`, reusing the file's fake `MessageBus` factory:

```ts
describe('portal bindAll', () => {
  it('creates ONE session and binds every spec in a single BindShortcuts call', async () => {
    const bus = fakeBus()
    const portal = createPortalShortcuts(async () => bus.messageBus)
    const set = await portal.bindAll([
      { id: 'ptt', description: 'Push to talk', binding: { key: { code: 188, name: 'F18' }, modifier: null } },
      { id: 'masks', description: 'Masks', binding: { key: { code: 183, name: 'F13' }, modifier: 'ctrl' } },
    ])

    expect(bus.calls.CreateSession).toHaveLength(1)
    expect(bus.calls.BindShortcuts).toHaveLength(1)
    const shortcuts = bus.calls.BindShortcuts[0][1] as [string, Record<string, { value: string }>][]
    expect(shortcuts.map((s) => s[0])).toEqual(['ptt', 'masks'])
    expect(shortcuts[1][1].preferred_trigger.value).toBe('CTRL+F13')
    await set.close()
  })

  it('routes Activated signals to the matching id and ignores other sessions', async () => {
    const bus = fakeBus()
    const set = await createPortalShortcuts(async () => bus.messageBus).bindAll([
      { id: 'ptt', description: 'Push to talk', binding: { key: { code: 188, name: 'F18' }, modifier: null } },
      { id: 'masks', description: 'Masks', binding: { key: { code: 183, name: 'F13' }, modifier: null } },
    ])
    const fired: string[] = []
    set.onActivated((id) => fired.push(id))

    bus.emitSignal('Activated', bus.sessionHandle, 'masks')
    bus.emitSignal('Activated', '/other/session', 'ptt')
    bus.emitSignal('Activated', bus.sessionHandle, 'unknown-id')

    expect(fired).toEqual(['masks'])
    await set.close()
  })
})
```

If `portal-shortcuts.test.ts` does not exist, create it with a `fakeBus()` that returns a `getProxyObject` yielding a `CreateSession`/`BindShortcuts` stub recording its arguments, replies through the low-level `_addMatch`/`message` path the module uses (emit a `Response` message on the derived request path with body `[0, { session_handle: { value: '/s/1' } }]`), and exposes `emitSignal(member, handle, id)` driving the `Activated`/`Deactivated` listeners registered via `gs.on`.

- [ ] **Step 9: Implement portal `bindAll`**

Rename the existing `bind` body to `bindAll(specs)`. The only substantive changes: build the shortcut array from every spec rather than one, and pass the fired `shortcutId` through to the callbacks instead of comparing against a captured `id`:

```ts
      const shortcuts = specs.map((s) => {
        const b = s.binding
        const trigger = b.modifier ? `${MODIFIER_LABELS[b.modifier].toUpperCase()}+${b.key.name}` : b.key.name
        return [s.id, {
          description: new Variant('s', s.description),
          preferred_trigger: new Variant('s', trigger),
        }] as const
      })
      await awaitResponse(bus, bindToken, () => gs.BindShortcuts(
        sessionHandle, shortcuts, '', { handle_token: new Variant('s', bindToken) },
      ))

      const ids = new Set(specs.map((s) => s.id))
      const activated = (handle: string, shortcutId: string) => {
        if (handle === sessionHandle && ids.has(shortcutId)) onAct?.(shortcutId)
      }
```

Keep a `bind` wrapper with the same one-element shape as the other two backends.

- [ ] **Step 10: Run the full suite and commit**

Run: `npm -w @axistream/app run test`
Expected: PASS — critically, every pre-existing push-to-talk test passes **unchanged**.

```bash
cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..
git add packages/app/src/main/evdev-keys.ts packages/app/src/main/windows-keys.ts packages/app/src/main/portal-shortcuts.ts packages/app/test
git commit -m "feat(hotkeys): multiplex every binding onto one watcher per backend"
```

---

### Task 4: HotkeyService

**Files:**
- Create: `packages/app/src/main/HotkeyService.ts`
- Test: `packages/app/test/HotkeyService.test.ts`

**Interfaces:**
- Consumes: `HotkeyId`, `HotkeyBindings`, `Binding`, `BindSpec`, `BoundSet`, `HotkeyBackend` from `../shared/hotkeys.js` (Task 1); `PttBinding` from `../shared/keys.js`.
- Produces:

```ts
export interface HotkeyActions {
  phase(): AppState['phase']
  micEnabled(): boolean
  masksVisible(): boolean
  recordingActive(): boolean
  pttEnabled(): boolean
  goLive(): Promise<void>
  stopStream(): Promise<void>
  setMicEnabled(enabled: boolean): Promise<void>
  setMasksVisible(visible: boolean): Promise<void>
  startRecording(): Promise<{ ok: boolean; error?: string }>
  stopRecording(): Promise<{ ok: boolean; error?: string }>
  toast(kind: 'info' | 'success' | 'error', message: string): void
}
export interface HotkeyServiceDeps {
  selectBackend(): Promise<{ backend: HotkeyBackend; mode: 'passthrough' | 'exclusive' }>
  bindings(): HotkeyBindings
  pttBinding(): PttBinding | null
  actions: HotkeyActions
  onPttEdge(down: boolean): void
  onMode(mode: 'passthrough' | 'exclusive' | null): void
  now(): number
}
export class HotkeyService {
  constructor(deps: HotkeyServiceDeps)
  rebuild(): Promise<{ ok: boolean; error?: string }>
  close(): Promise<void>
  fire(id: HotkeyId): Promise<void>   // exported for tests; also the dispatch target
}
```

`END_STREAM_CONFIRM_MS = 2000`.

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/HotkeyService.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HotkeyService, END_STREAM_CONFIRM_MS } from '../src/main/HotkeyService.js'

const F13 = { code: 183, name: 'F13' }

function harness(over: Record<string, unknown> = {}) {
  let now = 1000
  const toasts: { kind: string; message: string }[] = []
  const actions = {
    phase: () => 'READY',
    micEnabled: () => true,
    masksVisible: () => true,
    recordingActive: () => false,
    pttEnabled: () => false,
    goLive: vi.fn(async () => {}),
    stopStream: vi.fn(async () => {}),
    setMicEnabled: vi.fn(async () => {}),
    setMasksVisible: vi.fn(async () => {}),
    startRecording: vi.fn(async () => ({ ok: true })),
    stopRecording: vi.fn(async () => ({ ok: true })),
    toast: (kind: string, message: string) => { toasts.push({ kind, message }) },
    ...over,
  }
  const svc = new HotkeyService({
    selectBackend: async () => ({ backend: { available: async () => true, bindAll: async () => ({ onActivated() {}, onDeactivated() {}, close: async () => {} }) }, mode: 'passthrough' }),
    bindings: () => ({ goLive: { key: F13, modifier: null }, micMute: null, masks: null, record: null }),
    pttBinding: () => null,
    actions: actions as never,
    onPttEdge: () => {},
    onMode: () => {},
    now: () => now,
  })
  return { svc, actions, toasts, advance: (ms: number) => { now += ms } }
}

describe('goLive hotkey', () => {
  it('goes live from READY', async () => {
    const h = harness()
    await h.svc.fire('goLive')
    expect(h.actions.goLive).toHaveBeenCalledOnce()
  })

  it('never opens a modal or fires from a blocked phase — it toasts the blocker', async () => {
    const h = harness({ phase: () => 'NEEDS_YOUTUBE' })
    await h.svc.fire('goLive')
    expect(h.actions.goLive).not.toHaveBeenCalled()
    expect(h.toasts[0].message).toMatch(/connect youtube/i)
  })

  it('toasts rather than acting while already going live', async () => {
    const h = harness({ phase: () => 'GOING_LIVE' })
    await h.svc.fire('goLive')
    expect(h.actions.goLive).not.toHaveBeenCalled()
    expect(h.actions.stopStream).not.toHaveBeenCalled()
  })

  it('requires a confirming second press to end a live stream', async () => {
    const h = harness({ phase: () => 'LIVE' })
    await h.svc.fire('goLive')
    expect(h.actions.stopStream).not.toHaveBeenCalled()
    expect(h.toasts[0].message).toMatch(/again/i)

    await h.svc.fire('goLive')
    expect(h.actions.stopStream).toHaveBeenCalledOnce()
  })

  it('lets the confirmation window expire', async () => {
    const h = harness({ phase: () => 'LIVE' })
    await h.svc.fire('goLive')
    h.advance(END_STREAM_CONFIRM_MS + 1)
    await h.svc.fire('goLive')
    expect(h.actions.stopStream).not.toHaveBeenCalled()
  })

  it('ends from RECONNECTING too', async () => {
    const h = harness({ phase: () => 'RECONNECTING' })
    await h.svc.fire('goLive')
    await h.svc.fire('goLive')
    expect(h.actions.stopStream).toHaveBeenCalledOnce()
  })

  it('resets the confirmation window when another action fires', async () => {
    const h = harness({ phase: () => 'LIVE' })
    await h.svc.fire('goLive')
    await h.svc.fire('masks')
    await h.svc.fire('goLive')
    expect(h.actions.stopStream).not.toHaveBeenCalled()
  })
})

describe('micMute hotkey', () => {
  it('toggles the mic', async () => {
    const h = harness({ micEnabled: () => true })
    await h.svc.fire('micMute')
    expect(h.actions.setMicEnabled).toHaveBeenCalledWith(false)
  })

  it('is inert while push-to-talk owns the mic', async () => {
    const h = harness({ pttEnabled: () => true })
    await h.svc.fire('micMute')
    expect(h.actions.setMicEnabled).not.toHaveBeenCalled()
    expect(h.toasts[0].message).toMatch(/push-to-talk/i)
  })
})

describe('masks hotkey', () => {
  it('toggles mask visibility', async () => {
    const h = harness({ masksVisible: () => true })
    await h.svc.fire('masks')
    expect(h.actions.setMasksVisible).toHaveBeenCalledWith(false)
  })
})

describe('record hotkey', () => {
  it('starts when idle and stops when active', async () => {
    const idle = harness({ recordingActive: () => false })
    await idle.svc.fire('record')
    expect(idle.actions.startRecording).toHaveBeenCalledOnce()

    const active = harness({ recordingActive: () => true })
    await active.svc.fire('record')
    expect(active.actions.stopRecording).toHaveBeenCalledOnce()
  })

  it('surfaces a refusal from the record gate as a toast', async () => {
    const h = harness({ startRecording: vi.fn(async () => ({ ok: false, error: 'An audio test is running' })) })
    await h.svc.fire('record')
    expect(h.toasts.at(-1)!.kind).toBe('error')
    expect(h.toasts.at(-1)!.message).toMatch(/audio test/i)
  })
})

describe('failure containment', () => {
  it('never lets a handler rejection escape', async () => {
    const h = harness({ setMasksVisible: vi.fn(async () => { throw new Error('obs died') }) })
    await expect(h.svc.fire('masks')).resolves.toBeUndefined()
    expect(h.toasts.at(-1)!.kind).toBe('error')
  })
})

describe('rebuild', () => {
  it('binds only the actions that have a binding, plus ptt when set', async () => {
    const specs: unknown[] = []
    const svc = new HotkeyService({
      selectBackend: async () => ({
        backend: {
          available: async () => true,
          bindAll: async (s: unknown[]) => { specs.push(...s); return { onActivated() {}, onDeactivated() {}, close: async () => {} } },
        },
        mode: 'exclusive',
      }),
      bindings: () => ({ goLive: { key: F13, modifier: null }, micMute: null, masks: null, record: null }),
      pttBinding: () => ({ key: { code: 188, name: 'F18' }, modifier: null }),
      actions: {} as never,
      onPttEdge: () => {},
      onMode: () => {},
      now: () => 0,
    })

    const r = await svc.rebuild()

    expect(r.ok).toBe(true)
    expect((specs as { id: string }[]).map((s) => s.id).sort()).toEqual(['goLive', 'ptt'])
  })

  it('is a no-op that reports ok when nothing is bound at all', async () => {
    const bindAll = vi.fn()
    const svc = new HotkeyService({
      selectBackend: async () => ({ backend: { available: async () => true, bindAll } as never, mode: 'passthrough' }),
      bindings: () => ({ goLive: null, micMute: null, masks: null, record: null }),
      pttBinding: () => null,
      actions: {} as never,
      onPttEdge: () => {},
      onMode: () => {},
      now: () => 0,
    })

    expect((await svc.rebuild()).ok).toBe(true)
    expect(bindAll).not.toHaveBeenCalled()
  })

  it('reports a bind failure without throwing', async () => {
    const svc = new HotkeyService({
      selectBackend: async () => ({ backend: { available: async () => true, bindAll: async () => { throw new Error('portal denied') } }, mode: 'exclusive' }),
      bindings: () => ({ goLive: { key: F13, modifier: null }, micMute: null, masks: null, record: null }),
      pttBinding: () => null,
      actions: {} as never,
      onPttEdge: () => {},
      onMode: () => {},
      now: () => 0,
    })

    const r = await svc.rebuild()
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/portal denied/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @axistream/app run test -- HotkeyService.test.ts`
Expected: FAIL — cannot resolve `../src/main/HotkeyService.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/app/src/main/HotkeyService.ts`:

```ts
// packages/app/src/main/HotkeyService.ts
// Owns every global binding — the four hotkey actions AND push-to-talk — on a
// single backend session, because each backend's watcher costs a poller over
// every input device. One watcher, N bindings.
//
// Nothing here may block or delay go-live, and no handler rejection may
// escape: these callbacks run outside any request context, so an unhandled
// rejection would surface as a crash with no renderer to report it.
import { HOTKEY_DESCRIPTIONS, HOTKEY_IDS, type BindSpec, type BoundSet, type HotkeyBackend, type HotkeyBindings, type HotkeyId } from '../shared/hotkeys.js'
import type { PttBinding } from '../shared/keys.js'
import type { AppState } from '../shared/state.js'

export interface HotkeyActions {
  phase(): AppState['phase']
  micEnabled(): boolean
  masksVisible(): boolean
  recordingActive(): boolean
  pttEnabled(): boolean
  goLive(): Promise<void>
  stopStream(): Promise<void>
  setMicEnabled(enabled: boolean): Promise<void>
  setMasksVisible(visible: boolean): Promise<void>
  startRecording(): Promise<{ ok: boolean; error?: string }>
  stopRecording(): Promise<{ ok: boolean; error?: string }>
  toast(kind: 'info' | 'success' | 'error', message: string): void
}

export interface HotkeyServiceDeps {
  selectBackend(): Promise<{ backend: HotkeyBackend; mode: 'passthrough' | 'exclusive' }>
  bindings(): HotkeyBindings
  pttBinding(): PttBinding | null
  actions: HotkeyActions
  onPttEdge(down: boolean): void
  onMode(mode: 'passthrough' | 'exclusive' | null): void
  now(): number
}

/** Ending a live broadcast is the one irreversible direction, so it takes a
 *  confirming second press. */
export const END_STREAM_CONFIRM_MS = 2000

export const PTT_ID = 'ptt'

export class HotkeyService {
  private set: BoundSet | null = null
  private endArmedAt = 0

  constructor(private readonly d: HotkeyServiceDeps) {}

  async rebuild(): Promise<{ ok: boolean; error?: string }> {
    await this.close()
    const bindings = this.d.bindings()
    const ptt = this.d.pttBinding()
    const specs: BindSpec[] = []
    for (const id of HOTKEY_IDS) {
      const b = bindings[id]
      if (b) specs.push({ id, description: HOTKEY_DESCRIPTIONS[id], binding: b })
    }
    if (ptt) specs.push({ id: PTT_ID, description: 'Push to talk', binding: ptt })
    if (specs.length === 0) {
      this.d.onMode(null)
      return { ok: true }
    }
    try {
      const { backend, mode } = await this.d.selectBackend()
      const set = await backend.bindAll(specs)
      set.onActivated((id) => {
        if (id === PTT_ID) { this.d.onPttEdge(true); return }
        void this.fire(id as HotkeyId)
      })
      set.onDeactivated((id) => { if (id === PTT_ID) this.d.onPttEdge(false) })
      this.set = set
      this.d.onMode(mode)
      return { ok: true }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.warn('[hotkeys] bind failed', error)
      this.d.onMode(null)
      return { ok: false, error }
    }
  }

  async close(): Promise<void> {
    if (!this.set) return
    const set = this.set
    this.set = null
    try { await set.close() } catch { /* best-effort */ }
  }

  /** Dispatch one action. Always resolves — a throwing handler becomes a
   *  toast, never an unhandled rejection. */
  async fire(id: HotkeyId): Promise<void> {
    const a = this.d.actions
    // Any action other than a repeat go-live press cancels the pending
    // end-stream confirmation, so an unrelated keypress can't leave the
    // stream one accidental press from dying.
    if (id !== 'goLive') this.endArmedAt = 0
    try {
      if (id === 'goLive') { await this.fireGoLive(); return }
      if (id === 'micMute') {
        if (a.pttEnabled()) { a.toast('info', 'Mic is controlled by push-to-talk.'); return }
        const next = !a.micEnabled()
        await a.setMicEnabled(next)
        a.toast('success', next ? 'Mic on' : 'Mic muted')
        return
      }
      if (id === 'masks') {
        const next = !a.masksVisible()
        await a.setMasksVisible(next)
        a.toast('success', next ? 'Masks shown' : 'Masks hidden')
        return
      }
      if (a.recordingActive()) {
        const r = await a.stopRecording()
        a.toast(r.ok ? 'success' : 'error', r.ok ? 'Recording stopped' : (r.error ?? 'Could not stop recording'))
      } else {
        const r = await a.startRecording()
        a.toast(r.ok ? 'success' : 'error', r.ok ? 'Recording started' : (r.error ?? 'Could not start recording'))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[hotkeys] ${id} failed`, msg)
      a.toast('error', msg)
    }
  }

  private async fireGoLive(): Promise<void> {
    const a = this.d.actions
    const phase = a.phase()
    if (phase === 'LIVE' || phase === 'RECONNECTING') {
      const now = this.d.now()
      if (this.endArmedAt && now - this.endArmedAt <= END_STREAM_CONFIRM_MS) {
        this.endArmedAt = 0
        await a.stopStream()
        a.toast('success', 'Ending the stream…')
        return
      }
      this.endArmedAt = now
      a.toast('info', 'Press again to end the stream')
      return
    }
    this.endArmedAt = 0
    if (phase === 'READY') { await a.goLive(); return }
    // A hotkey never opens a modal and never steals focus: the user is in
    // fullscreen and cannot see either. It explains itself and stops.
    a.toast('info', blockerFor(phase))
  }
}

function blockerFor(phase: AppState['phase']): string {
  if (phase === 'NEEDS_YOUTUBE') return 'Connect YouTube first'
  if (phase === 'NEEDS_TITLE') return 'Open AxiStream to set a stream title'
  if (phase === 'GOING_LIVE' || phase === 'STARTING_ON_YOUTUBE') return 'Already going live…'
  if (phase === 'ERROR') return 'AxiStream needs attention — open the window'
  return 'Set up capture first'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm -w @axistream/app run test -- HotkeyService.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..
git add packages/app/src/main/HotkeyService.ts packages/app/test/HotkeyService.test.ts
git commit -m "feat(hotkeys): HotkeyService — dispatch, phase guards, end-stream confirmation"
```

---

### Task 5: State slice, IPC channel, preload

**Files:**
- Modify: `packages/app/src/shared/state.ts`, `packages/app/src/main/ipc.ts`, `packages/app/src/preload/index.ts`
- Test: `packages/app/test/state.test.ts`

**Interfaces:**
- Consumes: `HotkeyId`, `Binding`, `HotkeyBindings` from `./hotkeys.js`.
- Produces: `AppState['hotkeys']`, `DEFAULT_HOTKEY_STATE`, `CH.setHotkey`, `AxiApi.setHotkey(id, binding)`, `SetHotkeyResult`.

- [ ] **Step 1: Write the failing test**

Append to `packages/app/test/state.test.ts`:

```ts
import { DEFAULT_HOTKEY_STATE, CH } from '../src/shared/state.js'

describe('hotkey state slice', () => {
  it('defaults to no bindings, no known mode, no error', () => {
    expect(DEFAULT_HOTKEY_STATE).toEqual({
      bindings: { goLive: null, micMute: null, masks: null, record: null },
      mode: null,
      error: null,
    })
  })

  it('exposes a setHotkey channel', () => {
    expect(CH.setHotkey).toBe('axi:setHotkey')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @axistream/app run test -- state.test.ts`
Expected: FAIL — `DEFAULT_HOTKEY_STATE` is not exported.

- [ ] **Step 3: Write the implementation**

In `packages/app/src/shared/state.ts`:

```ts
import type { Binding, HotkeyBindings, HotkeyId } from './hotkeys.js'

export interface HotkeyState {
  bindings: HotkeyBindings
  /** exclusive = bound keys are taken from the game; passthrough = they still
   *  reach it; null = nothing bound, or the backend could not arm. */
  mode: 'passthrough' | 'exclusive' | null
  error: string | null
}

export const DEFAULT_HOTKEY_STATE: HotkeyState = {
  bindings: { goLive: null, micMute: null, masks: null, record: null },
  mode: null,
  error: null,
}

/** Refused when another action or push-to-talk already holds the key —
 *  `conflict` carries that holder's label. */
export type SetHotkeyResult = { ok: true } | { ok: false; conflict: string }
```

Add `hotkeys: HotkeyState` to `AppState` and `hotkeys: DEFAULT_HOTKEY_STATE` to its default object. Add to `CH`:

```ts
  setHotkey: 'axi:setHotkey',
```

Add to `AxiApi`:

```ts
  setHotkey(id: HotkeyId, binding: Binding | null): Promise<SetHotkeyResult>
```

In `packages/app/src/main/ipc.ts`, add to the handlers interface and register it beside the other handlers:

```ts
  setHotkey(id: HotkeyId, binding: Binding | null): Promise<SetHotkeyResult>
```

```ts
  ipcMain.handle(CH.setHotkey, (_e: unknown, id: HotkeyId, binding: Binding | null) => handlers.setHotkey(id, binding))
```

In `packages/app/src/preload/index.ts`:

```ts
  setHotkey: (id, binding) => ipcRenderer.invoke(CH.setHotkey, id, binding) as Promise<SetHotkeyResult>,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm -w @axistream/app run test`
Expected: FAIL only where existing test fixtures build an `AppState` literal without `hotkeys`. Add `hotkeys: DEFAULT_HOTKEY_STATE` to each such fixture — this is the same mechanical fixture update every prior state-slice task made.

- [ ] **Step 5: Typecheck and commit**

```bash
cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..
git add packages/app/src/shared/state.ts packages/app/src/main/ipc.ts packages/app/src/preload/index.ts packages/app/test
git commit -m "feat(ipc): add the setHotkey channel and hotkey state slice"
```

---

### Task 6: Wire it up in main, and fold push-to-talk in

**Files:**
- Modify: `packages/app/src/main/index.ts`, `packages/app/src/main/PttController.ts`, and the three backends (delete the transitional `bind` wrappers)

**Interfaces:**
- Consumes: `HotkeyService`, `HotkeyActions`, `PTT_ID` from `./HotkeyService.js`; `findConflict`, `toBinding`, `toPersisted` from `../shared/hotkeys.js`.
- Produces: the `setHotkey` handler implementation; `PttController` with `bind`/`close` replaced by service-driven edges.

- [ ] **Step 1: Rewire `PttController` to consume edges rather than bind**

`PttController` keeps every mute behavior and loses only the binding. Replace `PortalDeps` with an edge-driven surface:

```ts
export interface PttDeps { muteOps: MuteOps; onActive(active: boolean): void; available(): Promise<boolean> }

export class PttController {
  private enabled = false
  constructor(private readonly d: PttDeps) {}

  isEnabled(): boolean { return this.enabled }

  async available(): Promise<boolean> {
    try { return await this.d.available() } catch { return false }
  }

  /** Called by HotkeyService when the 'ptt' shortcut's key goes down/up.
   *  onActive fires before the async unmute completes on purpose — instant UI
   *  feedback; the mic follows within the mute-op round trip. */
  onEdge(down: boolean): void {
    if (!this.enabled) return
    void this.setMute(!down)
    this.d.onActive(down)
  }

  /** Arming is now just the baseline mute — HotkeyService owns the binding. */
  async arm(): Promise<void> { this.enabled = true; await this.setMute(true) }

  async disarm(): Promise<void> {
    if (!this.enabled) return
    this.enabled = false
    await this.setMute(false)
    this.d.onActive(false)
  }
  // setMute, restore, and rearmSource are unchanged.
}
```

- [ ] **Step 2: Build the service in `index.ts`**

Replace the `PttController` construction block (around `index.ts:392-434`) so `selectBackend` returns the backend object with `bindAll`, and the service owns it:

```ts
  const hotkeys = new HotkeyService({
    selectBackend,
    bindings: () => {
      const h = settings.load().hotkeys
      return { goLive: toBinding(h.goLive), micMute: toBinding(h.micMute), masks: toBinding(h.masks), record: toBinding(h.record) }
    },
    // Push-to-talk only occupies a slot in the shared session while enabled.
    pttBinding: () => (settings.load().pttEnabled ? loadBinding() : null),
    actions: hotkeyActions,
    onPttEdge: (down) => ptt.onEdge(down),
    onMode: (mode) => setState({ hotkeys: { ...state.hotkeys, mode } }),
    now: () => Date.now(),
  })
```

`hotkeyActions` reads from the live `state` object and delegates to the same functions the IPC handlers call — **not** through `ipcMain`, which does not exist in the `--smoke` path:

```ts
  const hotkeyActions: HotkeyActions = {
    phase: () => state.phase,
    micEnabled: () => state.audio.micEnabled,
    masksVisible: () => state.masksVisible,
    recordingActive: () => state.recording.active,
    pttEnabled: () => ptt.isEnabled(),
    goLive: () => api.goLive(),
    stopStream: () => api.stopStream(),
    setMicEnabled: (e) => api.setMicEnabled(e),
    setMasksVisible: (v) => api.setMasksVisible(v),
    startRecording: () => api.startRecording(),
    stopRecording: () => api.stopRecording(),
    toast: (kind, message) => toast(win, { kind, message }),
  }
```

- [ ] **Step 3: Route every path that changes a binding through one rebuild**

Because all bindings share one session, `setPttEnabled`, `setPttBinding`, `capturePttKey`, and the new `setHotkey` all end in `hotkeys.rebuild()`. Add a helper so the ordering rule lives in exactly one place:

```ts
  // Every binding shares one session, so any change is a full close + bindAll.
  // In that gap NO hotkey is live, push-to-talk included — so re-apply its
  // baseline mute after the rebuild. Getting this wrong strands the mic hot.
  const rebuildHotkeys = async (): Promise<{ ok: boolean; error?: string }> => {
    const r = await hotkeys.rebuild()
    if (settings.load().pttEnabled) await ptt.arm()
    setState({ hotkeys: { ...state.hotkeys, error: r.ok ? null : (r.error ?? 'failed') } })
    return r
  }
```

Rewrite the push-to-talk handlers to call it: `setPttEnabled(true)` does `settings.patch` then `ptt.arm()` via `rebuildHotkeys()`; `setPttEnabled(false)` does `settings.patch` then `await ptt.disarm()` then `rebuildHotkeys()`. `setPttBinding` and the accept path of `capturePttKey` patch settings then call `rebuildHotkeys()` — replacing today's disable/enable pair.

- [ ] **Step 4: Implement the `setHotkey` handler**

```ts
    setHotkey: async (id, binding) => {
      if (binding) {
        const conflict = findConflict(id, binding, bindingsNow(), settings.load().pttEnabled ? loadBinding() : null)
        if (conflict) return { ok: false, conflict }
      }
      const next = { ...settings.load().hotkeys, [id]: toPersisted(binding) }
      settings.patch({ hotkeys: next })
      setState({ hotkeys: { ...state.hotkeys, bindings: { ...state.hotkeys.bindings, [id]: binding } } })
      await rebuildHotkeys()
      return { ok: true }
    },
```

where `bindingsNow()` is the same reader the service's `bindings()` uses — extract it to a single named function and use it in both places rather than duplicating the four `toBinding` calls.

- [ ] **Step 5: Seed the slice at boot and rebuild once**

In `getInitialState`, seed `hotkeys: { bindings: bindingsNow(), mode: state.hotkeys.mode, error: state.hotkeys.error }` — the bindings live in `settings.json` regardless of whether capture is provisioned, so an unprovisioned boot must not report an empty registry. Call `void rebuildHotkeys()` once during boot, after settings load, and let it fail quietly: nothing here may block boot.

- [ ] **Step 6: Delete the transitional wrappers**

Remove `bind` from `portal-shortcuts.ts`, `evdev-keys.ts`, and `windows-keys.ts`, plus the now-unused `BoundShortcut` exports. Update `PttController`'s and the backends' tests that still call `bind` to call `bindAll` with a one-element array.

- [ ] **Step 7: Run the full gates**

```bash
npm -w @axistream/app run test
npm -w @axistream/capture run test
cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..
```

Expected: PASS. Push-to-talk's own behavioral tests should need only the mechanical `bind` → `bindAll` and `enable`/`disable` → `arm`/`disarm` renames. If any push-to-talk *assertion* had to change, stop: the refactor altered behavior.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src packages/app/test
git commit -m "feat(hotkeys): one shared session for push-to-talk and every hotkey action"
```

---

### Task 7: Nullable KeyPicker

**Files:**
- Create: `packages/app/src/renderer/components/KeyPicker.tsx` (git-mv from `PttKeyPicker.tsx`)
- Modify: `packages/app/src/renderer/components/AudioSettings.tsx`
- Test: `packages/app/test/key-picker.test.tsx` (rename from the existing picker test, if one exists)

**Interfaces:**
- Produces:

```tsx
export function KeyPicker({ binding, onBind, onClear }: {
  binding: Binding | null
  onBind: (b: Binding) => void
  onClear?: () => void
}): JSX.Element
```

- [ ] **Step 1: Rename the file and update the import**

```bash
git mv packages/app/src/renderer/components/PttKeyPicker.tsx packages/app/src/renderer/components/KeyPicker.tsx
```

Rename the exported function `PttKeyPicker` → `KeyPicker` and update `AudioSettings.tsx`'s import and usage. Do not change behavior in this step.

- [ ] **Step 2: Write the failing test**

Create `packages/app/test/key-picker.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { KeyPicker } from '../src/renderer/components/KeyPicker.js'

describe('KeyPicker unbound state', () => {
  it('offers to set a key when nothing is bound', () => {
    render(<KeyPicker binding={null} onBind={vi.fn()} />)
    expect(screen.getByRole('button', { name: /set key/i })).toBeInTheDocument()
  })

  it('shows the bound key and a clear affordance when one is set', () => {
    const onClear = vi.fn()
    render(<KeyPicker binding={{ key: { code: 183, name: 'F13' }, modifier: null }} onBind={vi.fn()} onClear={onClear} />)
    expect(screen.getByRole('button', { name: 'F13' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('omits the clear affordance when no onClear is given (push-to-talk always has a key)', () => {
    render(<KeyPicker binding={{ key: { code: 188, name: 'F18' }, modifier: null }} onBind={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull()
  })

  it('binds the chosen key from the unbound state', () => {
    const onBind = vi.fn()
    render(<KeyPicker binding={null} onBind={onBind} />)
    fireEvent.click(screen.getByRole('button', { name: /set key/i }))
    fireEvent.click(screen.getByRole('button', { name: 'F13' }))
    expect(onBind).toHaveBeenCalledWith({ key: { code: 183, name: 'F13' }, modifier: null })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm -w @axistream/app run test -- key-picker.test.tsx`
Expected: FAIL — the component still takes `keyName`/`keyCode`/`modifier`.

- [ ] **Step 4: Implement the nullable binding**

Change the props to `{ binding, onBind, onClear }`. When `binding` is `null`, render a single `Set key` button that opens the existing key list; the modifier chip and the `+ modifier` control render only when a key is set (a modifier without a key is meaningless). When `onClear` is provided and a key is set, render a `Clear` button beside the combo. Everything else — the group list, the search box, the typing-key warning — is unchanged.

Update `AudioSettings.tsx` to pass `binding={{ key: { code: ptt.keyCode, name: ptt.keyName }, modifier: ptt.modifier }}` and no `onClear`.

- [ ] **Step 5: Run the tests**

Run: `npm -w @axistream/app run test`
Expected: PASS, including the existing push-to-talk picker tests after their mechanical prop update.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer packages/app/test
git commit -m "refactor(ui): generalize PttKeyPicker into a nullable KeyPicker"
```

---

### Task 8: Hotkey Settings section

**Files:**
- Create: `packages/app/src/renderer/components/HotkeySettings.tsx`
- Modify: `packages/app/src/renderer/components/SettingsScreen.tsx`
- Test: `packages/app/test/hotkey-settings.test.tsx`

**Interfaces:**
- Consumes: `KeyPicker` (Task 7), `HOTKEY_IDS`/`HOTKEY_LABELS` (Task 1), `AppState['hotkeys']` and `AxiApi.setHotkey` (Task 5).

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/hotkey-settings.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HotkeySettings } from '../src/renderer/components/HotkeySettings.js'
import { DEFAULT_HOTKEY_STATE } from '../src/shared/state.js'

const api = (over: Record<string, unknown> = {}) => ({
  setHotkey: vi.fn(async () => ({ ok: true })),
  ...over,
}) as never

describe('HotkeySettings', () => {
  it('renders a row per action, all unbound by default', () => {
    render(<HotkeySettings hotkeys={DEFAULT_HOTKEY_STATE} axi={api()} />)
    for (const label of ['Go live / End stream', 'Mic mute', 'Masks', 'Record']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getAllByRole('button', { name: /set key/i })).toHaveLength(4)
  })

  it('warns that bound keys are taken from the game on the exclusive backend', () => {
    render(<HotkeySettings hotkeys={{ ...DEFAULT_HOTKEY_STATE, mode: 'exclusive' }} axi={api()} />)
    expect(screen.getByText(/won't reach guild wars 2/i)).toBeInTheDocument()
  })

  it('says keys still reach the game on a pass-through backend', () => {
    render(<HotkeySettings hotkeys={{ ...DEFAULT_HOTKEY_STATE, mode: 'passthrough' }} axi={api()} />)
    expect(screen.getByText(/still reach guild wars 2/i)).toBeInTheDocument()
  })

  it('shows the refusal, naming the holder, when a key is already bound', async () => {
    const axi = api({ setHotkey: vi.fn(async () => ({ ok: false, conflict: 'Masks' })) })
    render(<HotkeySettings hotkeys={DEFAULT_HOTKEY_STATE} axi={axi} />)

    fireEvent.click(screen.getAllByRole('button', { name: /set key/i })[0])
    fireEvent.click(screen.getByRole('button', { name: 'F13' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/already bound to Masks/i))
  })

  it('clears a binding through setHotkey(id, null)', () => {
    const axi = api()
    render(<HotkeySettings axi={axi} hotkeys={{
      ...DEFAULT_HOTKEY_STATE,
      bindings: { ...DEFAULT_HOTKEY_STATE.bindings, masks: { key: { code: 183, name: 'F13' }, modifier: null } },
    }} />)

    fireEvent.click(screen.getByRole('button', { name: /clear/i }))

    expect(axi.setHotkey).toHaveBeenCalledWith('masks', null)
  })

  it('surfaces a bind error from the backend', () => {
    render(<HotkeySettings axi={api()} hotkeys={{ ...DEFAULT_HOTKEY_STATE, error: 'portal denied' }} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/portal denied/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @axistream/app run test -- hotkey-settings.test.tsx`
Expected: FAIL — cannot resolve `HotkeySettings.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/app/src/renderer/components/HotkeySettings.tsx`. One row per `HOTKEY_IDS` entry, each a label plus a `KeyPicker`; the mode line above the rows; a `role="alert"` region carrying either the last conflict message or `hotkeys.error`:

```tsx
import { useState } from 'react'
import { HOTKEY_IDS, HOTKEY_LABELS, type Binding, type HotkeyId } from '../../shared/hotkeys.js'
import type { AppState, AxiApi } from '../../shared/state.js'
import { KeyPicker } from './KeyPicker.js'

const MODE_COPY = {
  exclusive: "Bound keys are captured by AxiStream and won't reach Guild Wars 2.",
  passthrough: 'Bound keys still reach Guild Wars 2.',
}

export function HotkeySettings({ hotkeys, axi }: { hotkeys: AppState['hotkeys']; axi: AxiApi }) {
  const [conflict, setConflict] = useState<string | null>(null)
  const bind = async (id: HotkeyId, binding: Binding | null) => {
    setConflict(null)
    const r = await axi.setHotkey(id, binding)
    if (!r.ok) setConflict(`${HOTKEY_LABELS[id]}: that key is already bound to ${r.conflict}.`)
  }
  const alert = conflict ?? hotkeys.error
  return (
    <>
      <h3>Hotkeys</h3>
      <p className="muted">Control AxiStream without leaving the game. Nothing is bound until you set it.</p>
      {hotkeys.mode ? <p className="muted">{MODE_COPY[hotkeys.mode]}</p> : null}
      {alert ? <p className="setting-error" role="alert">{alert}</p> : null}
      <div className="hotkey-rows">
        {HOTKEY_IDS.map((id) => (
          <div className="hotkey-row" key={id}>
            <span className="hotkey-label">{HOTKEY_LABELS[id]}</span>
            <KeyPicker binding={hotkeys.bindings[id]} onBind={(b) => void bind(id, b)} onClear={() => void bind(id, null)} />
          </div>
        ))}
      </div>
    </>
  )
}
```

Mount it in `SettingsScreen.tsx` as its own `<section className="setting">`, placed after `AudioSettings` (push-to-talk's home) so the two shortcut-shaped controls read together:

```tsx
          <section className="setting">
            <HotkeySettings hotkeys={state.hotkeys} axi={axi} />
          </section>
```

Add `.hotkey-rows` / `.hotkey-row` / `.hotkey-label` rules to the stylesheet alongside the existing `.keypicker` rules — a two-column row, label left, picker right, matching the spacing of the neighbouring settings rows.

- [ ] **Step 4: Run the tests**

Run: `npm -w @axistream/app run test -- hotkey-settings.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full gates and commit**

```bash
npm -w @axistream/app run test
npm -w @axistream/capture run test
cd packages/app && npx tsc --noEmit -p tsconfig.json && cd ../..
git add packages/app/src packages/app/test
git commit -m "feat(ui): Hotkeys settings section with conflict and backend-mode reporting"
```

---

## Final Verification

Automated gates:

```bash
npm -w @axistream/app run test
npm -w @axistream/capture run test
cd packages/app && npx tsc --noEmit -p tsconfig.json
```

Manual smoke, which no unit test can cover — the backends only exist against real hardware:

1. Linux, **pass-through** backend (udev unlocked): bind all four actions. Confirm each fires, and confirm the bound keys **still reach Guild Wars 2**.
2. Linux, **exclusive** backend (portal, udev locked): rebind. Confirm the approval dialog appears **once** for the whole set, not once per action, and that bound keys **stop reaching the game**.
3. With push-to-talk enabled, confirm it still gates the mic after each hotkey rebind — this is the path that strands the mic hot if the rebuild ordering is wrong.
4. Press the go-live hotkey from `NEEDS_YOUTUBE` and confirm a toast appears and no window steals focus.
5. Go live, press the hotkey once (toast only), wait three seconds, press again — the stream must still be live. Then press twice within two seconds and confirm it ends.
6. Windows: repeat steps 1, 3, and 5.
