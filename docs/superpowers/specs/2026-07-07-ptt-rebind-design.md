# Settable PTT Hotkey — Design

**Date:** 2026-07-07
**Status:** Approved (design via discussion); pending implementation plan
**Scope:** The PTT key (hardcoded F18 today) becomes user-settable in-app in
BOTH capture modes: press-any-key capture in pass-through (evdev), a curated
key picker in exclusive (portal). Blocking the next release.

## Design

### Canonical representation

A key is `{ code: number; name: string }` — the evdev keycode is the truth
(what the pass-through backend filters on); the name doubles as the display
label and the portal `preferred_trigger` hint. Persisted as two settings:

- `pttKeyCode: number` (default `188`)
- `pttKeyName: string` (default `'F18'`)

Sanitized: code = integer 1..767 else default; name = non-empty string else
default. Existing installs keep F18.

### Shared key table — `packages/app/src/shared/keys.ts` (new)

```ts
export interface PttKey { code: number; name: string }
export const PTT_KEY_CHOICES: PttKey[] = [ /* F1..F12 (59..88 per input-event-codes), F13..F24 (183..194), Pause 119, ScrollLock 70, Insert 110, Home 102, End 107, PageUp 104, PageDown 109 */ ]
export function keyName(code: number): string   // table lookup, else `KEY_${code}`
```
Exact codes (input-event-codes.h): F1-F10 = 59-68, F11 = 87, F12 = 88,
F13-F24 = 183-194, PAUSE = 119, SCROLLLOCK = 70, INSERT = 110, HOME = 102,
END = 107, PAGEUP = 104, PAGEDOWN = 109.
Shared (renderer dropdown + main backends) — lives in `src/shared/`, imports
nothing.

### Plumbing the key to the backends

The backend `bind` signature changes from `(id, description,
preferredTrigger: string)` to `(id, description, key: PttKey)`:
- portal backend uses `key.name` as `preferred_trigger` (unchanged wire
  format);
- evdev backend filters `ev.code === key.code` (KEY_F18 constant retired to
  the shared table).

`PttController` gains a `key(): PttKey` dep (like `sourceId()`); `enable()`
passes `this.d.key()` to bind. index.ts supplies `() => { const s =
settings.load(); return { code: s.pttKeyCode, name: s.pttKeyName } }` —
fresh per enable, so a rebind + re-arm picks up the new key.

### Capture-next-key (pass-through rebind) — in `evdev-keys.ts`

```ts
export function captureNextKey(deps?: EvdevDeps, timeoutMs = 10000): Promise<PttKey | null>
```
Opens the readable devices exactly like `bind`, resolves on the first
`EV_KEY` value-1 event with `{ code, name: keyName(code) }`, cleans up all
streams, `null` on timeout. Escape (code 1) cancels → `null` (so the user
can back out with the keyboard).

### State, IPC, rebind flow

- `AppState.ptt` gains `keyName: string` (from settings at boot and on every
  ptt push — the UI never hardcodes F18 again).
- IPC `setPttKey(key: PttKey): Promise<void>` — persists both fields, then
  if PTT is enabled: `disable()` → `enable()` (same in-place re-arm as the
  unlock; portal mode re-binds with the new hint — KDE may show its binding
  dialog again, which is expected).
- IPC `capturePttKey(): Promise<PttKey | null>` — pass-through mode only
  (guarded: returns null when evdev unavailable); runs `captureNextKey`.
  While capturing, PTT must not fire on the pressed key: capture runs with
  PTT temporarily disabled (`disable()` first, re-enable after — whether or
  not a key was captured).

### UI (AudioSettings PTT block)

- Toggle label becomes `Push to talk (hold {ptt.keyName})`; all F18 mentions
  (tooltips, muted-pill text, quick-toggle tooltip in Sidebar) go dynamic.
- A `Rebind` control next to the mode line:
  - pass-through mode: button `Rebind` → row shows `Press any key… (Esc to
    cancel)` → resolves → shows the new name. Uses `capturePttKey`.
  - exclusive mode: a `<select>` of `PTT_KEY_CHOICES` (current key selected)
    → change calls `setPttKey` immediately. Helper text: "Binding again may
    show a KDE confirmation."
- Sidebar quick-toggle tooltip uses `state.ptt.keyName`.

## Error handling

Best-effort throughout: capture timeout/cancel → UI returns to idle, no
change; re-arm failure surfaces via the existing `ptt.error` path; invalid
persisted values sanitize back to F18. The unlock/mode machinery is
untouched.

## Testing

- keys.ts: table sanity (F13=183, F18=188, F24=194), `keyName` fallback.
- evdev-keys: bind filters on the PASSED code (not 188); captureNextKey
  resolves on first keydown with name, ignores non-EV_KEY and value!=1,
  Escape → null, timeout → null, streams cleaned up.
- portal-shortcuts: bind passes `key.name` as preferred_trigger (fake-bus
  assertion updated).
- PttController: `key()` dep threaded to bind (harness assertion).
- StreamSettings: defaults 188/'F18', round-trip, sanitize.
- UI: dynamic label; pass-through rebind flow (capturing state, result);
  exclusive dropdown calls setPttKey; Sidebar tooltip dynamic.
- Manual smoke: rebind to F15 via press-to-bind in pass-through → hold F15
  transmits, F18 doesn't; switch to exclusive (portal) → dropdown to F13 →
  KDE dialog → F13 works.
