# PTT Key Picker — Combo Builder Design

**Date:** 2026-07-07
**Status:** Mockup approved in-app ("looks good"); combo behavior = real
gating (option A from the discussion): PTT activates only while the chosen
modifier is held AND the key is pressed.
**Scope:** Replace the passthrough-mode `<select>` with a grouped, searchable
key-grid picker supporting one optional modifier; gate the evdev bind on the
modifier; pass a combo hint to the portal. Exclusive mode keeps its existing
`<select>` for now (its key set can move to the new component later).

## Data model

`shared/keys.ts` grows:

```ts
export type PttModifier = 'ctrl' | 'alt' | 'shift' | 'super'
export interface PttBinding { key: PttKey; modifier: PttModifier | null }
export const MODIFIER_CODES: Record<PttModifier, [number, number]> = {
  ctrl: [29, 97], shift: [42, 54], alt: [56, 100], super: [125, 126],
}   // [left, right] evdev codes — either side satisfies the modifier
export const MODIFIER_LABELS: Record<PttModifier, string> = {
  ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', super: 'Super',
}
```

`PTT_KEY_CHOICES` is replaced by grouped tables (all evdev codes from
input-event-codes.h):

```ts
export interface PttKeyGroup { label: string; keys: PttKey[] }
export const PTT_KEY_GROUPS: PttKeyGroup[] = [
  { label: 'Function', keys: [F1..F12 = 59..88 per existing table, F13..F24 = 183..194] },
  { label: 'Letters', keys: [Q16 W17 E18 R19 T20 Y21 U22 I23 O24 P25 A30 S31 D32 F33 G34 H35 J36 K37 L38 Z44 X45 C46 V47 B48 N49 M50 — alphabetically sorted A–Z for display] },
  { label: 'Numbers', keys: ['1'..'9' = 2..10, '0' = 11] },
  { label: 'Navigation & misc', keys: [Insert 110, Home 102, End 107, PageUp 104, PageDown 109, Pause 119, ScrollLock 70, Grave 41, Backslash 43] },
]
```

`keyName()` and `isKnownKey()` now consult the flattened groups (same
behavior, wider table). Settings gain `pttModifier: '' | PttModifier`
(default `''` = none), validated on load like `pttKeyCode`.

## Engine — evdev combo gating (`evdev-keys.ts`)

`bind(id, description, binding: PttBinding)`. Without a modifier, behavior
is unchanged. With one:

- Modifier state is tracked **globally across all streams** (the modifier
  can come from the keyboard while the key comes from the mouse): a
  keydown/keyup of either the left or right code of the chosen modifier
  updates a shared `modifierHeld` flag. Auto-repeat (value 2) is ignored.
- Activation: key down while `modifierHeld` → `onActivated`.
- Deactivation: key up while active, OR modifier up while active (no sticky
  transmit if Ctrl is released before the key).
- A key down without the modifier held is ignored (no activation on
  late-modifier).
- Modifier state starts `false`; a modifier already held before arming
  isn't seen until its next edge (accepted limitation, noted in code).

## Engine — portal (`portal-shortcuts.ts`, `PttController.ts`)

`bind` takes the same `PttBinding`; `preferred_trigger` becomes
`'CTRL+F18'`-style (`MODIFIER_LABELS[m].toUpperCase() + '+' + key.name`, or
just `key.name` when no modifier). It remains a hint — KDE may show its own
confirmation. `PttController`'s `PttDeps.key()` becomes
`binding(): PttBinding` reading `pttKeyCode/pttKeyName/pttModifier`.

## IPC

`setPttKey(key)` becomes `setPttBinding(binding: PttBinding)` — patches all
three settings fields and re-arms live (same disable/enable dance).
`AppState.ptt.keyName` becomes the display string including the modifier
(e.g. `Ctrl + F18`) via a `bindingLabel(binding)` helper in shared/keys.ts —
the sidebar quick-toggle and "hold {keyName}" copy pick it up for free.
Capture (`capturePttKey`) is unchanged and sets only the key, clearing the
modifier (a captured press replaces the whole binding —
`pttModifier: ''`).

## UI — `PttKeyPicker.tsx` (new component, renderer)

Per the approved mockup:

- Combo row: optional modifier chip (cyan tint, ✕ to remove), `+` separator,
  current-key chip (click toggles the grid), and a "+ modifier" dashed
  button opening a 4-item menu (Ctrl/Alt/Shift/Super). Picking a modifier
  replaces any existing one (single modifier only).
- Key grid: search input (case-insensitive substring on key names) above
  grouped key buttons (Function / Letters / Numbers / Navigation & misc);
  the bound key is highlighted; clicking a key applies the binding
  immediately (`setPttBinding`) — no separate save.
- Off-table current key (e.g. `KEY_275` from Rebind) renders in the key
  chip and stays bound until a grid key is picked.
- Warning line under the grid when the bound key is a letter or number:
  "Heads up: this key triggers PTT while typing anywhere."
- The picker replaces the passthrough block's `<select>`; "…or press the
  key: Rebind" and the capture countdown/feedback stay below it.
- Styles in `styles.css` following existing tokens (ghost `#1a222c`,
  border `#2a323b`, cyan `#26d3ee`, radius 8–12px, `.muted` copy).

## Error handling

Unchanged philosophy — the backends never throw out; a bad persisted
modifier value loads as `''`. `bindingLabel` handles null modifier.

## Testing

- shared/keys: group tables contain the exact codes above (spot-check
  Q=16, A=30, '1'=2, '0'=11, Grave=41); `keyName` resolves group members
  and falls back to `KEY_<n>`; `bindingLabel` with/without modifier.
- evdev bind with modifier (fake deps, existing pattern): activation only
  when modifier down first; late-modifier keydown ignored; modifier-up
  deactivates while active; either left or right modifier code works;
  cross-device (modifier on one stream, key on another) activates; repeats
  ignored; no-modifier binding behaves exactly as before (existing tests
  keep passing with the widened bind signature).
- portal: `preferred_trigger` string is `CTRL+F18` with modifier, `F18`
  without (existing portal test pattern).
- Renderer: picker renders groups; clicking a key calls `setPttBinding`
  with the key + current modifier; adding/removing the modifier chip calls
  `setPttBinding`; search filters; letter warning shows for letters/numbers
  only.
- Manual smoke (user): bind Ctrl+F18 → PTT only transmits with Ctrl held;
  remove modifier → plain F18 works; bind letter V → warning shown, typing
  v transmits (expected, documented).

## Not in scope

- Multiple simultaneous modifiers (single chip only, per mockup).
- Mouse buttons in the grid (Rebind capture already covers off-table
  codes).
- Migrating the exclusive-mode `<select>` to the new picker (follow-up).
