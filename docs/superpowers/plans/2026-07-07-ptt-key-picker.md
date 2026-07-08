# PTT Key Picker (Combo Builder) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grouped searchable key-grid picker with one optional modifier (Ctrl/Alt/Shift/Super) for passthrough PTT; the evdev bind gates on the modifier, the portal gets a `CTRL+F18`-style hint.

**Architecture:** `shared/keys.ts` gains grouped key tables, `PttModifier`/`PttBinding`, and `bindingLabel`. Both backends' `bind` take a `PttBinding`; evdev tracks modifier state globally across streams. The `setPttKey` IPC becomes `setPttBinding`. A new `PttKeyPicker` renderer component implements the approved mockup.

**Tech Stack:** Electron main + React 18 + TS 5.5, vitest 2 (fork pool ≤2).

**Spec:** `docs/superpowers/specs/2026-07-07-ptt-key-picker-design.md`

## Global Constraints

- Code style: 2-space indent, **no semicolons**, single quotes, named exports, `.js` extensions on relative imports (ESM/NodeNext).
- Nothing throws out of the evdev/portal backends.
- Modifier evdev codes (left, right): ctrl (29, 97), shift (42, 54), alt (56, 100), super (125, 126). EV_KEY = 1; value 1 = down, 0 = up, 2 = repeat (ignored).
- Settings field `pttModifier`: `'' | 'ctrl' | 'alt' | 'shift' | 'super'`, default `''`; invalid persisted values load as `''`.
- Portal `preferred_trigger`: `'F18'` without modifier, `'CTRL+F18'` (modifier label uppercased + `+` + key name) with.
- Tests: `npm -w @axistream/app run test` (fork pool ≤2). Typecheck gate: `cd packages/app && npx tsc --noEmit -p tsconfig.json`.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Shared key tables, PttBinding, bindingLabel

**Files:**
- Modify: `packages/app/src/shared/keys.ts`
- Test: `packages/app/test/keys.test.ts` (append)

**Interfaces:**
- Consumes: existing `PttKey`, `PTT_KEY_CHOICES` (kept — exclusive-mode select still uses it), `keyName`, `isKnownKey`.
- Produces (Tasks 2–3 rely on these exact names): `PttModifier`, `PttBinding`, `MODIFIER_CODES`, `MODIFIER_LABELS`, `PTT_KEY_GROUPS` (`PttKeyGroup { label: string; keys: PttKey[] }`), `bindingLabel(b: PttBinding): string`. `keyName`/`isKnownKey` now resolve over the union of `PTT_KEY_CHOICES` and all group keys.

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/test/keys.test.ts`:

```ts
describe('key groups and bindings', () => {
  it('groups carry the exact evdev codes (spot checks)', () => {
    const flat = new Map(PTT_KEY_GROUPS.flatMap((g) => g.keys).map((k) => [k.name, k.code]))
    expect(flat.get('Q')).toBe(16)
    expect(flat.get('A')).toBe(30)
    expect(flat.get('M')).toBe(50)
    expect(flat.get('1')).toBe(2)
    expect(flat.get('0')).toBe(11)
    expect(flat.get('Grave')).toBe(41)
    expect(flat.get('Backslash')).toBe(43)
    expect(flat.get('F18')).toBe(188)
    expect(flat.get('PageDown')).toBe(109)
  })
  it('letters are alphabetical for display', () => {
    const letters = PTT_KEY_GROUPS.find((g) => g.label === 'Letters')!.keys.map((k) => k.name)
    expect(letters).toEqual([...letters].sort())
    expect(letters).toHaveLength(26)
  })
  it('keyName resolves group members and falls back to KEY_<n>', () => {
    expect(keyName(47)).toBe('V')
    expect(keyName(188)).toBe('F18')
    expect(keyName(275)).toBe('KEY_275')
  })
  it('MODIFIER_CODES carries left/right evdev pairs', () => {
    expect(MODIFIER_CODES.ctrl).toEqual([29, 97])
    expect(MODIFIER_CODES.shift).toEqual([42, 54])
    expect(MODIFIER_CODES.alt).toEqual([56, 100])
    expect(MODIFIER_CODES.super).toEqual([125, 126])
  })
  it('bindingLabel renders with and without modifier', () => {
    expect(bindingLabel({ key: { code: 188, name: 'F18' }, modifier: null })).toBe('F18')
    expect(bindingLabel({ key: { code: 188, name: 'F18' }, modifier: 'ctrl' })).toBe('Ctrl + F18')
  })
})
```

Extend the test file's import from `'../src/shared/keys.js'` with `PTT_KEY_GROUPS, MODIFIER_CODES, bindingLabel`.

- [ ] **Step 2: Run to verify failure**

Run: `npm -w @axistream/app run test -- keys`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Implement**

In `packages/app/src/shared/keys.ts`, after the existing `PTT_KEY_CHOICES`, add:

```ts
export type PttModifier = 'ctrl' | 'alt' | 'shift' | 'super'
export interface PttBinding { key: PttKey; modifier: PttModifier | null }

/** [left, right] evdev codes — either side satisfies the modifier. */
export const MODIFIER_CODES: Record<PttModifier, [number, number]> = {
  ctrl: [29, 97], shift: [42, 54], alt: [56, 100], super: [125, 126],
}
export const MODIFIER_LABELS: Record<PttModifier, string> = {
  ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', super: 'Super',
}

export interface PttKeyGroup { label: string; keys: PttKey[] }

const LETTER_CODES: Record<string, number> = {
  A: 30, B: 48, C: 46, D: 32, E: 18, F: 33, G: 34, H: 35, I: 23, J: 36,
  K: 37, L: 38, M: 50, N: 49, O: 24, P: 25, Q: 16, R: 19, S: 31, T: 20,
  U: 22, V: 47, W: 17, X: 45, Y: 21, Z: 44,
}

export const PTT_KEY_GROUPS: PttKeyGroup[] = [
  { label: 'Function', keys: [
    ...Array.from({ length: 10 }, (_, i) => ({ code: 59 + i, name: `F${i + 1}` })),
    { code: 87, name: 'F11' },
    { code: 88, name: 'F12' },
    ...Array.from({ length: 12 }, (_, i) => ({ code: 183 + i, name: `F${i + 13}` })),
  ] },
  { label: 'Letters', keys: Object.keys(LETTER_CODES).sort().map((n) => ({ code: LETTER_CODES[n], name: n })) },
  { label: 'Numbers', keys: [
    ...Array.from({ length: 9 }, (_, i) => ({ code: 2 + i, name: `${i + 1}` })),
    { code: 11, name: '0' },
  ] },
  { label: 'Navigation & misc', keys: [
    { code: 110, name: 'Insert' },
    { code: 102, name: 'Home' },
    { code: 107, name: 'End' },
    { code: 104, name: 'PageUp' },
    { code: 109, name: 'PageDown' },
    { code: 119, name: 'Pause' },
    { code: 70, name: 'ScrollLock' },
    { code: 41, name: 'Grave' },
    { code: 43, name: 'Backslash' },
  ] },
]

export function bindingLabel(b: PttBinding): string {
  return b.modifier ? `${MODIFIER_LABELS[b.modifier]} + ${b.key.name}` : b.key.name
}
```

Then change the `NAMES` map construction so `keyName`/`isKnownKey` resolve over the union:

```ts
const NAMES = new Map([...PTT_KEY_CHOICES, ...PTT_KEY_GROUPS.flatMap((g) => g.keys)].map((k) => [k.code, k.name]))
```

(`NAMES` must be declared AFTER `PTT_KEY_GROUPS` — move the `const NAMES` line down if needed; `keyName`/`isKnownKey` bodies are unchanged.)

- [ ] **Step 4: Run tests and typecheck**

Run: `npm -w @axistream/app run test -- keys` — expected: PASS.
Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` — expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared/keys.ts packages/app/test/keys.test.ts
git commit -m "feat(ptt): grouped key tables + PttBinding/modifier vocabulary

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Binding threading + evdev modifier gating

**Files:**
- Modify: `packages/app/src/main/evdev-keys.ts` (bind signature + gating)
- Modify: `packages/app/src/main/portal-shortcuts.ts` (bind signature + trigger string)
- Modify: `packages/app/src/main/PttController.ts` (`PortalDeps.bind`, `PttDeps.binding()`)
- Modify: `packages/app/src/main/StreamSettings.ts` (`pttModifier` field, default `''`, validation)
- Modify: `packages/app/src/main/index.ts` (deps wiring, `setPttBinding` handler, keyName→bindingLabel state pushes, capture clears modifier)
- Modify: `packages/app/src/main/ipc.ts` or wherever `IpcHandlers.setPttKey` is typed (rename to `setPttBinding`, payload `PttBinding` — find with `grep -rn "setPttKey" packages/app/src`)
- Modify: `packages/app/src/preload/index.ts`, `packages/app/src/shared/state.ts` (channel + api rename)
- Modify: `packages/app/src/renderer/components/AudioSettings.tsx` (ONLY the two existing `setPttKey` call sites → `setPttBinding({ key: k, modifier: null })`; no other renderer work — Task 3 owns the picker)
- Test: `packages/app/test/evdev-keys.test.ts`, `packages/app/test/portal-shortcuts.test.ts`, `packages/app/test/ptt-controller.test.ts`

**Interfaces:**
- Consumes: `PttBinding`, `MODIFIER_CODES`, `bindingLabel` from Task 1.
- Produces: `createEvdevShortcuts(...).bind(id, description, binding: PttBinding)`; `createPortalShortcuts(...).bind(id, description, binding: PttBinding)`; `PttDeps.binding(): PttBinding`; IPC `setPttBinding(b: PttBinding): Promise<void>` on channel `axi:setPttBinding`; `AppState.ptt.keyName` now carries the display label (e.g. `Ctrl + F18`). Task 3 calls `axi().setPttBinding(...)` and reads `ptt.keyName`.

- [ ] **Step 1: Write the failing tests**

`packages/app/test/evdev-keys.test.ts` — update every existing `backend.bind('ptt', 'Push to talk', { code: X, name: N })` call to `backend.bind('ptt', 'Push to talk', { key: { code: X, name: N }, modifier: null })` (5 sites), then append:

```ts
describe('createEvdevShortcuts modifier gating', () => {
  function modHarness() {
    const devs = { '/dev/input/event3': fakeDevice(), '/dev/input/event7': fakeDevice() }
    const backend = createEvdevShortcuts({
      listDevices: () => Object.keys(devs),
      canRead: () => true,
      openStream: (p) => devs[p as keyof typeof devs].stream as never,
    })
    return { backend, devs }
  }
  const CTRL_L = 29, CTRL_R = 97

  it('activates only when the modifier is already held', async () => {
    const h = modHarness()
    const sc = await h.backend.bind('ptt', 'Push to talk', { key: { code: 188, name: 'F18' }, modifier: 'ctrl' })
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    sc.onDeactivated(() => seq.push('up'))
    const dev = h.devs['/dev/input/event3']
    dev.emitData(frame(1, 188, 1))       // no modifier — ignored
    dev.emitData(frame(1, 188, 0))
    dev.emitData(frame(1, CTRL_L, 1))
    dev.emitData(frame(1, 188, 1))       // ctrl held — fires
    dev.emitData(frame(1, 188, 0))
    dev.emitData(frame(1, CTRL_L, 0))
    expect(seq).toEqual(['down', 'up'])
  })

  it('modifier release while active deactivates (no sticky transmit)', async () => {
    const h = modHarness()
    const sc = await h.backend.bind('ptt', 'Push to talk', { key: { code: 188, name: 'F18' }, modifier: 'ctrl' })
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    sc.onDeactivated(() => seq.push('up'))
    const dev = h.devs['/dev/input/event3']
    dev.emitData(frame(1, CTRL_R, 1))    // right ctrl counts too
    dev.emitData(frame(1, 188, 1))
    dev.emitData(frame(1, CTRL_R, 0))    // ctrl up first — deactivate
    dev.emitData(frame(1, 188, 0))       // key up after — no second 'up'
    expect(seq).toEqual(['down', 'up'])
  })

  it('modifier on one device gates a key on another', async () => {
    const h = modHarness()
    const sc = await h.backend.bind('ptt', 'Push to talk', { key: { code: 188, name: 'F18' }, modifier: 'ctrl' })
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    h.devs['/dev/input/event3'].emitData(frame(1, CTRL_L, 1))   // keyboard
    h.devs['/dev/input/event7'].emitData(frame(1, 188, 1))      // mouse
    expect(seq).toEqual(['down'])
  })

  it('without a modifier the binding behaves as before', async () => {
    const h = modHarness()
    const sc = await h.backend.bind('ptt', 'Push to talk', { key: { code: 188, name: 'F18' }, modifier: null })
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    sc.onDeactivated(() => seq.push('up'))
    const dev = h.devs['/dev/input/event3']
    dev.emitData(frame(1, CTRL_L, 1))    // stray modifier — irrelevant
    dev.emitData(frame(1, 188, 1))
    dev.emitData(frame(1, 188, 2))       // repeat — ignored
    dev.emitData(frame(1, 188, 0))
    expect(seq).toEqual(['down', 'up'])
  })
})
```

`packages/app/test/portal-shortcuts.test.ts` — update the two `portal.bind(...)` calls to the binding shape (`{ key: { code: 188, name: 'F18' }, modifier: null }`), keep the `preferred_trigger` assertion `'F18'`, and add after the existing trigger test:

```ts
  it('a modifier prefixes the preferred_trigger hint', async () => {
    // mirror the existing bind test's harness setup verbatim, then:
    const shortcut = await portal.bind('ptt', 'Push to talk', { key: { code: 188, name: 'F18' }, modifier: 'ctrl' })
    expect(shortcuts[0][1].preferred_trigger.value).toBe('CTRL+F18')
    await shortcut.close()
  })
```

(Adapt the harness lines from the test directly above it — same fake bus pattern.)

`packages/app/test/ptt-controller.test.ts` — rename the `key()` dep in the test harness to `binding()` returning `{ key: { code: 188, name: 'F18' }, modifier: null }` and update the "enable binds with the key from the key() dep" test to assert the binding object reaches `portal.bind` (same structure, new shape).

- [ ] **Step 2: Run to verify failure**

Run: `npm -w @axistream/app run test -- evdev-keys portal-shortcuts ptt-controller`
Expected: FAIL — bind signatures still take `PttKey`.

- [ ] **Step 3: Implement**

`packages/app/src/main/evdev-keys.ts` — import `MODIFIER_CODES, type PttBinding` from `'../shared/keys.js'` (keep existing imports) and replace `bind`:

```ts
    async bind(_id: string, _description: string, binding: PttBinding): Promise<BoundShortcut> {
      const { key, modifier } = binding
      const modCodes = modifier ? MODIFIER_CODES[modifier] : null
      const readable = deps.listDevices().filter((d) => deps.canRead(d))
      if (readable.length === 0) throw new Error('no readable input devices — pass-through is locked')
      let onAct: (() => void) | null = null
      let onDeact: (() => void) | null = null
      // modifier + active state are shared across ALL device streams — the
      // modifier can come from the keyboard while the key comes from the
      // mouse. A modifier already held before arming isn't seen until its
      // next edge (accepted: worst case is one missed activation).
      let modifierHeld = false
      let active = false
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
            if (modCodes && (ev.code === modCodes[0] || ev.code === modCodes[1])) {
              if (ev.value === 1) modifierHeld = true
              else if (ev.value === 0) {
                modifierHeld = false
                if (active) { active = false; onDeact?.() }
              }
              continue
            }
            if (ev.code !== key.code) continue
            if (ev.value === 1) {
              if ((!modCodes || modifierHeld) && !active) { active = true; onAct?.() }
            } else if (ev.value === 0) {
              if (active) { active = false; onDeact?.() }
            }
            // value 2 = auto-repeat: ignored (the key is already down)
          }
        }) as never)
        stream.on('error', ((e: Error) => {
          console.warn(`[ptt] evdev device dropped (${path}):`, e.message)
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
```

Also update the function's jsdoc ("watches for the configured key's edges" → "watches for the configured binding's edges; an optional modifier gates activation").

`packages/app/src/main/portal-shortcuts.ts` — change the import to `import { MODIFIER_LABELS, type PttBinding } from '../shared/keys.js'` (drop the now-unused `PttKey` type import if nothing else uses it), change `bind(id, description, binding: PttBinding)`, and compute the trigger:

```ts
      const trigger = binding.modifier ? `${MODIFIER_LABELS[binding.modifier].toUpperCase()}+${binding.key.name}` : binding.key.name
```

then use `preferred_trigger: new Variant('s', trigger)`.

`packages/app/src/main/PttController.ts`:

```ts
import { type PttBinding } from '../shared/keys.js'
export interface PortalDeps {
  available(): Promise<boolean>
  bind(id: string, description: string, binding: PttBinding): Promise<PortalShortcut>
}
export interface PttDeps { portal: PortalDeps; exec: ExecLike; sourceId(): string; onActive(active: boolean): void; binding(): PttBinding }
```

and in `enable()`: `sc = await this.d.portal.bind('ptt', 'Push to talk', this.d.binding())`.

`packages/app/src/main/StreamSettings.ts` — add to the interface `pttModifier: '' | 'ctrl' | 'alt' | 'shift' | 'super'`, to `DEFAULT_SETTINGS` `pttModifier: '',` and to the load-validation block (same pattern as `pttKeyCode` at line ~121):

```ts
        pttModifier: raw.pttModifier === 'ctrl' || raw.pttModifier === 'alt' || raw.pttModifier === 'shift' || raw.pttModifier === 'super' ? raw.pttModifier : DEFAULT_SETTINGS.pttModifier,
```

`packages/app/src/main/index.ts`:
- Add a helper next to the ptt deps (`import { bindingLabel, type PttBinding } ...` extending the existing shared/keys import):

```ts
  const loadBinding = (): PttBinding => {
    const s = settings.load()
    return { key: { code: s.pttKeyCode, name: s.pttKeyName }, modifier: s.pttModifier === '' ? null : s.pttModifier }
  }
```

- Replace the deps entry `key: () => {...}` with `binding: loadBinding`.
- Replace every `keyName: settings.load().pttKeyName` / `keyName: a.pttKeyName` / `keyName: key.name` state push with `keyName: bindingLabel(loadBinding())` (grep `keyName:` in index.ts — ~7 sites; for the boot site using `a` the settings are already loaded, `bindingLabel({ key: { code: a.pttKeyCode, name: a.pttKeyName }, modifier: a.pttModifier === '' ? null : a.pttModifier })` or just call `loadBinding()` — prefer `loadBinding()` everywhere for one code path).
- Rename the `setPttKey` handler to `setPttBinding`:

```ts
    setPttBinding: async (b: PttBinding) => {
      settings.patch({ pttKeyCode: b.key.code, pttKeyName: b.key.name, pttModifier: b.modifier ?? '' })
      setState({ ptt: { ...state.ptt, keyName: bindingLabel(b) } })
      if (ptt.isEnabled()) {
        await ptt.disable()
        const r = await ptt.enable()
        setState({ ptt: { ...state.ptt, enabled: r.ok, active: false, error: r.ok ? null : (r.error ?? 'failed'), mode: r.ok ? pttMode : null, keyName: bindingLabel(b) } })
      }
    },
```

- In `capturePttKey`, the settings patch on `{ key }` also clears the modifier: `settings.patch({ pttKeyCode: result.key.code, pttKeyName: result.key.name, pttModifier: '' })` and the state push uses `keyName: bindingLabel({ key: result.key, modifier: null })`.

Channel + types: in `packages/app/src/shared/state.ts` rename `setPttKey: 'axi:setPttKey'` → `setPttBinding: 'axi:setPttBinding'` and the api method to `setPttBinding(b: PttBinding): Promise<void>` (import `PttBinding`). Mirror in `packages/app/src/preload/index.ts` and wherever `IpcHandlers` types the method (`grep -rn "setPttKey" packages/app/src` and update every hit).

`packages/app/src/renderer/components/AudioSettings.tsx` — both existing `axi().setPttKey(k)` call sites (exclusive-mode select and passthrough select) become `axi().setPttBinding({ key: k, modifier: null })`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm -w @axistream/app run test` — expected: PASS (all files; `grep -rn "setPttKey" packages/app` must return zero hits).
Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` — expected: clean.

- [ ] **Step 5: Commit**

```bash
git add -A packages/app/src packages/app/test
git commit -m "feat(ptt): PttBinding threads both backends — evdev modifier gating, portal combo hint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: PttKeyPicker component

**Files:**
- Create: `packages/app/src/renderer/components/PttKeyPicker.tsx`
- Modify: `packages/app/src/renderer/components/AudioSettings.tsx` (passthrough block: replace the `<select>` label with `<PttKeyPicker …/>`)
- Modify: `packages/app/src/renderer/styles.css` (append picker styles)
- Test: `packages/app/test/ptt-key-picker.test.tsx` (new)

**Interfaces:**
- Consumes: `PTT_KEY_GROUPS`, `MODIFIER_LABELS`, `bindingLabel`, types from `shared/keys.ts`; `axi().setPttBinding(b)` from Task 2; `ptt.keyName` display label from AppState.
- Produces: `export function PttKeyPicker({ keyName, keyCode, modifier, onBind }: { keyName: string; keyCode: number; modifier: PttModifier | null; onBind: (b: PttBinding) => void })`.

**Where the props come from:** `AppState.ptt` only carries the display label, so AudioSettings needs the raw parts. Extend `AppState.ptt` in `packages/app/src/shared/state.ts` with `keyCode: number` and `modifier: PttModifier | null` (defaults `188` / `null`), and set them in `index.ts` wherever `keyName` is pushed (all sites already call `loadBinding()` after Task 2 — push `keyCode: b.key.code, modifier: b.modifier` alongside). This is a mechanical extension of Task 2's state pushes; tsc enforces completeness.

- [ ] **Step 1: Write the failing tests**

Create `packages/app/test/ptt-key-picker.test.tsx` following the render/query style of `audio-settings.test.tsx` (same @testing-library/react setup):

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PttKeyPicker } from '../src/renderer/components/PttKeyPicker.js'

const bindProps = { keyName: 'F18', keyCode: 188, modifier: null as const }

describe('PttKeyPicker', () => {
  it('renders the current key chip and groups when opened', () => {
    render(<PttKeyPicker {...bindProps} onBind={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'F18' }))
    expect(screen.getByText('Function')).toBeTruthy()
    expect(screen.getByText('Letters')).toBeTruthy()
    expect(screen.getByText('Numbers')).toBeTruthy()
  })

  it('clicking a grid key binds it with the current modifier', () => {
    const onBind = vi.fn()
    render(<PttKeyPicker {...bindProps} modifier="ctrl" onBind={onBind} />)
    fireEvent.click(screen.getByRole('button', { name: 'F18' }))
    fireEvent.click(screen.getByRole('button', { name: 'F19' }))
    expect(onBind).toHaveBeenCalledWith({ key: { code: 189, name: 'F19' }, modifier: 'ctrl' })
  })

  it('adding and removing a modifier rebinds', () => {
    const onBind = vi.fn()
    const { rerender } = render(<PttKeyPicker {...bindProps} onBind={onBind} />)
    fireEvent.click(screen.getByRole('button', { name: '+ modifier' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl' }))
    expect(onBind).toHaveBeenCalledWith({ key: { code: 188, name: 'F18' }, modifier: 'ctrl' })
    rerender(<PttKeyPicker {...bindProps} modifier="ctrl" onBind={onBind} />)
    fireEvent.click(screen.getByRole('button', { name: /remove modifier/i }))
    expect(onBind).toHaveBeenCalledWith({ key: { code: 188, name: 'F18' }, modifier: null })
  })

  it('search filters the grid', () => {
    render(<PttKeyPicker {...bindProps} onBind={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'F18' }))
    fireEvent.change(screen.getByPlaceholderText(/search keys/i), { target: { value: 'pageup' } })
    expect(screen.getByRole('button', { name: 'PageUp' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'F19' })).toBeNull()
  })

  it('warns when a letter or number is bound', () => {
    render(<PttKeyPicker keyName="V" keyCode={47} modifier={null} onBind={vi.fn()} />)
    expect(screen.getByText(/triggers PTT while typing/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm -w @axistream/app run test -- ptt-key-picker`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement the component**

`packages/app/src/renderer/components/PttKeyPicker.tsx`:

```tsx
import { useState } from 'react'
import { PTT_KEY_GROUPS, MODIFIER_LABELS, type PttBinding, type PttKey, type PttModifier } from '../../shared/keys.js'

const TYPING_GROUPS = new Set(['Letters', 'Numbers'])
const typingKey = (code: number) => PTT_KEY_GROUPS.some((g) => TYPING_GROUPS.has(g.label) && g.keys.some((k) => k.code === code))

export function PttKeyPicker({ keyName, keyCode, modifier, onBind }: {
  keyName: string
  keyCode: number
  modifier: PttModifier | null
  onBind: (b: PttBinding) => void
}) {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const key: PttKey = { code: keyCode, name: keyName }
  const q = query.trim().toLowerCase()
  return (
    <div className="keypicker">
      <div className="keypicker-combo">
        {modifier && (
          <span className="keypicker-chip">
            {MODIFIER_LABELS[modifier]}
            <button aria-label="remove modifier" className="keypicker-x" onClick={() => onBind({ key, modifier: null })}>✕</button>
          </span>
        )}
        {modifier && <span className="keypicker-plus">+</span>}
        <button className="keypicker-key" onClick={() => setOpen((o) => !o)}>{keyName}</button>
        <div className="keypicker-menu">
          <button className="keypicker-addmod" onClick={() => setMenuOpen((m) => !m)}>+ modifier</button>
          {menuOpen && (
            <div className="keypicker-menulist">
              {(Object.keys(MODIFIER_LABELS) as PttModifier[]).map((m) => (
                <button key={m} onClick={() => { setMenuOpen(false); onBind({ key, modifier: m }) }}>{MODIFIER_LABELS[m]}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      {open && (
        <div className="keypicker-grid">
          <input placeholder="Search keys… (e.g. f18, v, pageup)" value={query} onChange={(e) => setQuery(e.target.value)} />
          {PTT_KEY_GROUPS.map((g) => {
            const keys = g.keys.filter((k) => k.name.toLowerCase().includes(q))
            if (keys.length === 0) return null
            return (
              <div key={g.label} className="keypicker-group">
                <div className="keypicker-glabel">{g.label}</div>
                <div className="keypicker-keys">
                  {keys.map((k) => (
                    <button key={k.code} className={k.code === keyCode ? 'keypicker-k sel' : 'keypicker-k'}
                      onClick={() => onBind({ key: k, modifier })}>{k.name}</button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {typingKey(keyCode) && <p className="muted">Heads up: this key triggers PTT while typing anywhere.</p>}
    </div>
  )
}
```

- [ ] **Step 4: Integrate into AudioSettings**

In the passthrough block of `AudioSettings.tsx`, replace the `Push-to-talk key` `<label className="muted">…<select>…</select></label>` (added in commit 4bfa287) with the picker. Note the component needs the KEY's raw name, not the `Ctrl + F18` display label that `ptt.keyName` now carries — extend `AppState.ptt` with `keyCode` and `modifier` (as the Interfaces section says) and derive the raw name via `keyName(ptt.keyCode)` imported from `'../../shared/keys.js'`:

```tsx
              <PttKeyPicker keyName={keyName(ptt.keyCode)} keyCode={ptt.keyCode} modifier={ptt.modifier}
                onBind={(b) => axi().setPttBinding(b)} />
```

(`keyName` resolves off-table codes to `KEY_<n>`, matching Rebind results.) Import `keyName` in AudioSettings.

- [ ] **Step 5: Styles**

Append to `packages/app/src/renderer/styles.css`:

```css
/* PTT key picker (combo builder) */
.keypicker { display: flex; flex-direction: column; gap: 8px; margin: 6px 0; }
.keypicker-combo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.keypicker-chip { display: inline-flex; align-items: center; gap: 7px; background: rgba(38,211,238,.12); border: 1px solid rgba(38,211,238,.45); color: #26d3ee; border-radius: 9px; padding: 6px 10px; font-size: 12px; font-weight: 700; }
.keypicker-x { background: none; border: 0; color: inherit; opacity: .7; cursor: pointer; font-size: 13px; padding: 0; }
.keypicker-x:hover { opacity: 1; }
.keypicker-plus { color: #8b98a5; font-weight: 800; }
.keypicker-key { background: #1f2732; border: 1px solid #3a4552; color: #e6edf3; border-radius: 9px; padding: 6px 12px; font-size: 12px; font-weight: 800; cursor: pointer; }
.keypicker-key:hover { border-color: #26d3ee; }
.keypicker-menu { position: relative; }
.keypicker-addmod { background: #1a222c; border: 1px dashed #2a323b; color: #8b98a5; border-radius: 9px; padding: 6px 10px; font-size: 11px; font-weight: 600; cursor: pointer; }
.keypicker-addmod:hover { color: #e6edf3; border-color: #3a4552; }
.keypicker-menulist { position: absolute; top: 110%; left: 0; background: #161c26; border: 1px solid #2a323b; border-radius: 10px; padding: 6px; z-index: 5; min-width: 120px; box-shadow: 0 12px 30px rgba(0,0,0,.5); }
.keypicker-menulist button { display: block; width: 100%; text-align: left; background: none; border: 0; color: #e6edf3; font-size: 12px; padding: 6px 10px; border-radius: 7px; cursor: pointer; }
.keypicker-menulist button:hover { background: #222c38; }
.keypicker-grid { background: #161c26; border: 1px solid #2a323b; border-radius: 12px; padding: 12px; }
.keypicker-grid input { width: 100%; box-sizing: border-box; background: #0f141b; border: 1px solid #2a323b; border-radius: 8px; color: #e6edf3; padding: 7px 10px; font-size: 12px; margin-bottom: 10px; outline: none; }
.keypicker-grid input:focus { border-color: #26d3ee; }
.keypicker-group { margin-bottom: 8px; }
.keypicker-glabel { color: #8b98a5; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; font-weight: 800; margin-bottom: 6px; }
.keypicker-keys { display: flex; flex-wrap: wrap; gap: 5px; }
.keypicker-k { background: #1a222c; border: 1px solid #2a323b; color: #c7d0d9; border-radius: 7px; padding: 4px 9px; font-size: 11px; font-weight: 600; cursor: pointer; min-width: 28px; }
.keypicker-k:hover { background: #222c38; border-color: #3a4552; }
.keypicker-k.sel { background: rgba(38,211,238,.15); border-color: #26d3ee; color: #26d3ee; }
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm -w @axistream/app run test` — expected: PASS.
Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` — expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/renderer/components/PttKeyPicker.tsx packages/app/src/renderer/components/AudioSettings.tsx packages/app/src/renderer/styles.css packages/app/test/ptt-key-picker.test.tsx packages/app/src/shared/state.ts packages/app/src/main/index.ts
git commit -m "feat(ptt): combo-builder key picker — grouped grid, modifier chip, typing warning

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
