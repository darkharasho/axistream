# Global Hotkeys — Design

**Date:** 2026-08-25
**Status:** Approved
**Umbrella spec:** `docs/superpowers/specs/2026-08-24-v1.0-release-design.md` (sub-project 6)

## Problem

AxiStream's controls all live in a window that is behind Guild Wars 2 whenever the
player is doing the thing the app exists to broadcast. Going live, muting, hiding
masks, and starting a recording all require alt-tabbing out of a fight.

Push-to-talk already solved the hard half of this. It owns three global-shortcut
backends — the XDG GlobalShortcuts portal (Linux, exclusive), an evdev reader
(Linux, pass-through, behind the udev unlock), and a `GetAsyncKeyState` poller
(Windows, pass-through) — and they already share one structural interface:

```
bind(id, description, binding) -> { onActivated, onDeactivated, close }
```

The `id` argument is threaded through and then ignored by every backend. What is
missing is not the ability to hear a key; it is an action registry above the
backends and a way for several bindings to share one watcher.

## Goal

Make go live / end stream, mic mute, mask visibility, and recording bindable to
global hotkeys on Linux and Windows, without regressing push-to-talk and without
adding a second copy of the edge-dispatch logic.

## The constraint that shapes everything

`createEvdevShortcuts().bind()` opens a poller on **every readable input device**,
and `createWindowsKeys().bind()` starts its own 25 ms timer. Neither looks at `id`.

Four new actions bound naively would mean five independent watchers over ~40 device
nodes each. That is the precise shape of the libuv thread-pool starvation that
killed push-to-talk before the `pollStream` fix (v0.1.6). Multiplexing the bindings
onto one watcher is therefore not an optimization — it is the requirement the rest
of this design is built around.

## Shared types

A new `packages/app/src/shared/hotkeys.ts` holds the registry, alongside the
existing `shared/keys.ts` (which keeps owning key codes, modifiers, and the
evdev-to-virtual-key mapping):

```ts
export type HotkeyId = 'goLive' | 'micMute' | 'masks' | 'record'
export const HOTKEY_IDS: HotkeyId[]                    // stable order for the UI
export const HOTKEY_LABELS: Record<HotkeyId, string>   // "Go live / End stream", ...

/** In-memory binding. Reuses PttKey and PttModifier from shared/keys.ts. */
export interface Binding { key: PttKey; modifier: PttModifier | null }
```

`Binding` is structurally identical to the existing `PttBinding`, deliberately —
that is what lets one backend call carry push-to-talk and the four actions in the
same array.

**One boundary rule, because the two representations differ.** Persisted settings
follow push-to-talk's existing convention and store an absent modifier as the empty
string `''`; every in-memory `Binding` uses `null`. Conversion happens once, at the
`StreamSettings` load and patch boundary, and nothing above that layer sees `''`.
The `'' | null` split is the single most likely source of a silent
"modifier never matches" bug, so it is stated as a rule rather than left to taste.

## Architecture

**A single `HotkeyService` in main owns every binding, push-to-talk's included.**

The backend interface becomes a batch call:

```ts
bindAll(specs: { id: HotkeyId; description: string; binding: Binding }[]): Promise<{
  onActivated(cb: (id: HotkeyId) => void): void
  onDeactivated(cb: (id: HotkeyId) => void): void
  close(): Promise<void>
}>
```

Each backend implements it with exactly one watcher:

- **portal** — one `CreateSession`, one `BindShortcuts` carrying the whole array.
  The D-Bus method already takes a list; today we pass a one-element array. A
  further benefit: KDE's interactive approval dialog fires once for the set rather
  than once per action.
- **evdev** — one pass over the readable device nodes, dispatching through a
  `code -> id[]` map. Same file-descriptor and timer count as push-to-talk alone
  costs today.
- **windows** — one 25 ms timer sweeping every bound virtual-key code.

`PttController` no longer calls `bind` itself. It subscribes to the `'ptt'` id's
activate and deactivate edges published by the service. Its mute logic,
`rearmSource`, baseline-mute discipline, and settings fields are unchanged.

### Why push-to-talk folds in rather than keeping its own session

Leaving `PttController` on its own session and giving the four new actions a second
shared one is a smaller diff over a file that has already been through a production
incident. It is rejected anyway: two watchers is the arrangement that rots. The next
action added has to pick a side, and the duplicated edge-dispatch logic — the
modifier-held state machine in particular — is exactly where a regression would
recur silently.

The refactor is well covered by existing seams. `evdev-keys.test.ts` already injects
`listDevices` / `canRead` / `openStream`, and the Windows backend has the same
dependency injection, so the multiplexing is testable without hardware.

### Backend asymmetry, and why the UI must state it

On the **portal** backend, a bound key is grabbed: Guild Wars 2 stops receiving it.
On the **evdev** and **Windows** pass-through backends, nothing is grabbed. This
asymmetry already exists for push-to-talk; four more bindings make it four times
more visible. The Settings UI is required to say which mode is active (see
"Settings UI"), because otherwise a Linux user on the portal binds `R`, loses a
skill key in game, and has no way to connect the two events.

## Actions

Four, and no more. Webcam toggle and copy-link were considered and cut: both are
things you do once, at your desk, with the window in front of you.

| Action | Id | Fires when | Otherwise |
|---|---|---|---|
| Go live / End stream | `goLive` | `READY` -> `goLive()`. `LIVE` or `RECONNECTING` -> a second press within 2 s -> `stopStream()` | Toast naming the blocker: "Connect YouTube first", "Set up capture first", "Already going live…" |
| Mic mute | `micMute` | Always -> `setMicEnabled(!micEnabled)` | Inert while push-to-talk is enabled (below) |
| Masks | `masks` | Always -> `setMasksVisible(!masksVisible)` | — |
| Record | `record` | Idle -> `startRecording()`. Active -> `stopRecording()` | Toast when the audio test owns the record output |

The service invokes the main-process handlers as injected callbacks. It does not
route through `ipcMain`: the renderer's channel exists for the renderer, a
main-to-main round trip buys nothing, and the IPC path does not exist in the
headless `--smoke` mode.

### Go live is a state machine, not a boolean

The other three actions toggle something. Going live can require input — the title
prompt — or be impossible in the current phase. A user pressing the key from inside
fullscreen Guild Wars 2 cannot see any of that, because the app is behind the game.

Therefore: **a hotkey never opens a modal and never steals focus.** It acts only
from the unambiguous phases (`READY`, `LIVE`, `RECONNECTING`); every other phase
produces a toast explaining the blocker and nothing else. Raising and focusing the
window instead was considered and rejected: yanking a player out of a fight is a
worse outcome than a message they read on their next alt-tab, and it would make the
key feel unpredictable — sometimes it streams, sometimes it hijacks the screen.

Ending a live broadcast is the one irreversible direction, so it requires a
confirming second press within 2 s. The window is tracked in the service and is
reset by any other action firing.

### Push-to-talk owns the mic when it is enabled

Push-to-talk holds the mic muted as its resting state and unmutes only while its key
is held. A mic-mute hotkey in that world is incoherent: whatever it sets is
overwritten on the next push-to-talk edge.

While push-to-talk is enabled, the mic-mute hotkey is inert and toasts "Mic is
controlled by push-to-talk." Making it toggle `pttEnabled` off instead was rejected
— one keypress should not silently replace the user's whole mic model mid-stream.

### Feedback

Every fire raises a toast, not only the refusals. There is no in-game overlay and
building one is far outside this sub-project, so toasts are the only channel
available. A user who pressed a key from fullscreen sees the toast on their next
alt-tab, which is the difference between "did that mute take?" and knowing.

Toast dispatch is fire-and-forget. Consistent with the project's conventions,
nothing on this path may block or delay go-live, and a handler that throws must
never escape — these callbacks run outside any request context, so an unhandled
rejection would surface as a crash with no renderer to report it.

## Persistence

A nested record in `StreamSettings`, rather than four copies of push-to-talk's flat
`pttKeyCode` / `pttKeyName` / `pttModifier` triple, which would mean twelve new flat
keys:

```ts
hotkeys: {
  goLive:  PersistedBinding | null
  micMute: PersistedBinding | null
  masks:   PersistedBinding | null
  record:  PersistedBinding | null
}

interface PersistedBinding {
  code: number
  name: string
  modifier: '' | 'ctrl' | 'alt' | 'shift' | 'super'   // '' means none, per the boundary rule
}
```

`null` means unbound, and unbound is every action's default.

Push-to-talk keeps its existing flat fields. Migrating them would require a settings
migration for no user-visible gain.

Load-time validation follows the established `StreamSettings` pattern with one
deliberate difference: where a malformed `pttKeyCode` falls back to the F18 default,
**a malformed hotkey entry falls back to `null`, never to a key.** A corrupted
settings file must not silently grab a key away from the game.

### Nothing is bound out of the box

Every candidate default key risks colliding with a Guild Wars 2 keybind, and on the
portal backend a collision does not merely add a hotkey — it silently removes a
skill button mid-fight. Push-to-talk sidesteps this by defaulting to F18, which no
physical keyboard sends.

Binding the four actions to F13–F16 by the same trick was considered. It is
collision-safe but binds keys most users cannot physically press, which reads as a
broken feature; and it saves the median user no trip to Settings, so the risk buys
nothing. Conventional defaults such as Ctrl+Alt+L are worse still, being keys Guild
Wars 2 can genuinely bind.

The asymmetry decides it: an unbound hotkey costs one trip to Settings, a wrongly
bound one can cost a stream.

## Conflicts

Binding a key already held by another action, or by push-to-talk, is **refused** at
the point of binding, with a message naming the current holder ("F13 is already
bound to Masks").

Letting the new binding steal the key was rejected: a user could un-bind their own
push-to-talk without noticing. Refusing costs one extra click and produces no
surprises.

Detection is a pure function over the settings record plus the push-to-talk triple,
so it is exhaustively testable.

## Rebinding lifecycle

Every binding shares one session, so changing any one of them tears the session down
and rebuilds it with the full set. Two consequences, recorded here rather than
discovered during implementation:

- On the portal backend a rebuild can re-trigger KDE's approval dialog. This is the
  price of the shared session and matches what push-to-talk rebinding already does.
- The rebuild is a full `close()` then `bindAll()`. In that gap no hotkey is live,
  push-to-talk included, so the rebuild must re-apply push-to-talk's baseline mute
  afterward exactly as `setPttBinding` does today. Getting this wrong strands the
  mic hot — which is the failure direction push-to-talk's design deliberately chose
  as the safe one, but it must be reached on purpose rather than by accident.

## Renderer state

One new slice on `AppState`:

```ts
hotkeys: {
  bindings: Record<HotkeyId, Binding | null>
  mode: 'passthrough' | 'exclusive' | null
  error: string | null
}
```

`mode` exists so Settings can tell the truth about whether bound keys reach the
game. It mirrors the value `PttController`'s backend selection already computes.

## Settings UI

A new `HotkeySettings.tsx` section in `SettingsScreen`, placed beside the existing
push-to-talk section rather than inside it. They share machinery, not a mental
model.

One row per action: label, the current binding or "Not bound", a picker, and a Clear
button. Above the rows, a single line driven by `mode`:

- **exclusive** — "Bound keys are captured by AxiStream and won't reach Guild Wars 2."
- **pass-through** — "Bound keys still reach Guild Wars 2."

`PttKeyPicker` assumes a binding always exists. It is extended to accept a nullable
binding, rendering a "Set key" affordance when `null`, and the file is renamed to
`KeyPicker.tsx` — it will serve five consumers and nothing about it is
push-to-talk-specific any more.

## Testing

Pure functions get exhaustive unit coverage:

- conflict detection across the four actions plus push-to-talk
- settings validation, including the "malformed entry -> `null`, never a key" rule
- the 2 s end-stream confirmation window, including its reset on another action
- a table-driven test over phase -> fires-or-toasts, for all four actions
- the mic-mute-is-inert-while-push-to-talk-is-enabled rule

Backend multiplexing is tested through the existing fake-dependency seams: one pass
over the evdev fakes dispatches to several ids; the Windows poller does the same
over several virtual-key codes; the portal gets a fake bus asserting a single
`CreateSession` and one `BindShortcuts` carrying the whole array.

Renderer tests cover the rows, the unbound state, the conflict refusal message, and
the mode banner.

**The regression signal that matters most: the existing push-to-talk tests should
pass essentially unchanged** once `PttController` consumes the shared service. If
they need rewriting, the refactor changed push-to-talk's behavior and something is
wrong.

Manual smoke, which no unit test can cover: bind all four on Linux under both
backends and confirm the grab / pass-through asymmetry is real, then repeat on
Windows.

## Out of scope

- Any in-game overlay. Toasts are the feedback channel.
- Chords beyond a single modifier.
- Mouse-button bindings. evdev can see `BTN_*` codes and the portal cannot, so
  allowing them would produce bindings that work on one Linux backend and silently
  die on the other.
- Webcam toggle and copy-link hotkeys.
- Migrating push-to-talk's flat settings fields into the new record.

## Gates

Per the umbrella spec: `npm -w @axistream/app run test`,
`npm -w @axistream/capture run test`, and
`cd packages/app && npx tsc --noEmit -p tsconfig.json`.
