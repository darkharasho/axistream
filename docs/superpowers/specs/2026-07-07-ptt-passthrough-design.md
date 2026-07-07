# PTT Pass-Through (evdev) + One-Click Unlock — Design

**Date:** 2026-07-07
**Status:** Approved (design via discussion); pending implementation plan
**Scope:** A second, observational PTT capture backend reading `/dev/input`
directly, so F18 *passes through* to every other listener — Discord's own
PTT included — instead of being consumed by the GlobalShortcuts portal.
Plus a one-click, pkexec-backed unlock button so non-technical users can
enable it without a terminal.

## Why

The portal backend (shipped) **consumes** the key on match: Discord's
raw-XI2 listener never sees F18 while our binding exists, so the user can't
run Discord's native PTT alongside ours. evdev reading is observational —
the kernel event stream is unmodified — so one key press opens both gates:
AxiStream's PipeWire source gate (unchanged) and Discord's own PTT.

Discord's method (raw XI2 on Xwayland) works only while an XWayland window
has focus; evdev works at any focus, on any compositor. Strictly broader.

## Non-goals

- Removing the portal backend (it remains the zero-setup fallback).
- In-app key rebinding (still F18; portal path still rebindable via KDE).
- Windows/macOS (Windows PTT will use Electron globalShortcut — see the
  Windows analysis doc).
- Handling the "someone revokes the udev rule mid-session" case beyond the
  next re-probe.

## Architecture

| Unit | Responsibility |
|------|----------------|
| `evdev-keys.ts` (new, app main) | pure: parse 24-byte `input_event` structs from a byte stream (`parseInputEvents(buf): { type, code, value }[]` handling partial frames); `KEY_F18 = 188`; plus `createEvdevShortcuts(deps)` returning the SAME `{ available, bind }` shape as `createPortalShortcuts` — bind opens every readable `/dev/input/event*`, streams events, fires onActivated (value 1) / onDeactivated (value 0) for code 188, ignores repeats (value 2); close() closes all fds. Injected fs deps for tests. |
| `input-unlock.ts` (new, app main) | the pkexec unlock: `unlockScript()` (pure — returns the exact shell run as root) and `runInputUnlock(exec)` → writes `/etc/udev/rules.d/70-axistream-input.rules` (`KERNEL=="event*", SUBSYSTEM=="input", TAG+="uaccess"`) then `udevadm control --reload-rules && udevadm trigger --subsystem-match=input`, via `pkexec sh -c '…'`. Returns `{ ok, error? }`; user-cancelled auth (pkexec exit 126/127) maps to a friendly "authorization was cancelled" message. |
| `PttController` (extend) | unchanged lifecycle; the injected `portal` dep is now whichever backend index.ts selects (they share a shape). |
| `index.ts` (extend) | backend selection at enable-time: probe evdev readability → evdev backend ("pass-through") else portal ("exclusive"); expose the active mode; `unlockPassthrough` IPC → runInputUnlock → re-probe → if PTT enabled, re-arm onto evdev. |
| `state.ts` / ipc / preload (extend) | `AppState.ptt.mode: 'passthrough' \| 'exclusive' \| null`; `unlockPassthrough(): Promise<{ ok: boolean; error?: string }>`. |
| `AudioSettings.tsx` (extend) | under the PTT toggle: mode line — pass-through: "Key events pass through — Discord's own push-to-talk works alongside." / exclusive: "AxiStream owns the key — Discord won't see F18." + button `Enable pass-through (asks for your admin password)` shown only in exclusive mode on Linux; security caveat line: "Grants apps in your session read access to input devices (required for pass-through)." Errors surfaced inline. |

### evdev details

- **Struct:** 64-bit `input_event` = 24 bytes: 16 (timeval, skipped), u16
  type, u16 code, s32 value — little-endian. `EV_KEY = 1`.
- **Device strategy:** open ALL `/dev/input/event*` that are readable
  (`createReadStream`), filter for `type===1 && code===188`. No keyboard
  classification needed — non-keyboards simply never emit code 188. Stream
  errors on individual devices are warned and that device dropped.
- **Partial frames:** the parser carries a remainder buffer between reads.
- **Availability probe:** `openSync` any one event device for reading →
  readable; every candidate throwing EACCES/ENOENT → not available.
- **Hotplug:** v1 rescans only on (re)enable — a keyboard plugged mid-
  session joins after a PTT toggle. Documented limitation.

### Backend selection & re-arming

`index.ts` builds both factories and selects per `enable()` call (probe at
that moment, not boot-cached), pushing `ptt.mode`. After a successful
unlock, if PTT is currently enabled: `disable()` then `enable()` — which
now selects evdev — a seamless in-place upgrade; portal binding is closed
(releasing the key back to Discord).

### Security caveat (UI copy, verbatim intent)

Pass-through requires seat-wide read access to input devices — the same
exposure as the `input` group or any evdev-based tool (OpenRGB, Steam input
rules). Stated plainly next to the unlock button, not hidden.

## Error handling

All best-effort: probe failures → portal mode; pkexec cancel/deny → friendly
error, stay exclusive; per-device stream errors dropped with a warn; nothing
may block boot/go-live; the source-gate safety rails (disable/boot/quit
unmute) are untouched.

## Testing

- **parseInputEvents:** exact 24-byte frames (press/release/repeat/other
  codes), partial-frame carry, empty/garbage tails.
- **createEvdevShortcuts:** injected fs — bind opens readable devices and
  fires activated/deactivated only for code 188 value 1/0 (repeat ignored);
  probe false when all opens throw; close closes fds.
- **input-unlock:** `unlockScript()` content pinned (rule text + udevadm
  sequence); exec-cancel mapping; success path.
- **index wiring:** review-verified (mode push, upgrade-on-unlock re-arm).
- **UI:** mode lines; unlock button only in exclusive mode; button calls
  `unlockPassthrough`; error inline.
- **Manual smoke:** enable PTT (portal) → Discord set to its own PTT on
  F18 → hold: Discord does NOT open (exclusive proves the problem);
  click unlock, password → mode flips pass-through → hold F18: BOTH open,
  and pressing while a Wayland-native window is focused still transmits.
