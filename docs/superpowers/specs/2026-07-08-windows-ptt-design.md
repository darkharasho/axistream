# Windows PTT Backend — Design

**Date:** 2026-07-08. **Status:** Approved direction ("keep going" down the
Windows bring-up list). **Runtime-untested on real Windows until the
hardware checklist** — this ships fully unit-tested, typed code.

## Approach

Passthrough-style observational capture, mirroring the Linux evdev design:
poll `GetAsyncKeyState` (user32, via the `koffi` prebuilt FFI package —
no compile step) every 25 ms for the bound key's Windows virtual-key code
plus the modifier's VKs. Nothing is consumed — Discord's own PTT coexists,
same as Linux passthrough. Electron's `globalShortcut` was rejected: it has
no key-up event, and PTT is all about release.

Mute side: on Windows, PTT gates the mic at the **OBS input** level
(`SetInputMute` on `'AxiStream Mic'`) instead of the PipeWire source —
no Core Audio COM. Consequence (documented in UI copy later): on Windows
PTT gates the *stream* mic only, not system-wide.

## Components

1. **`shared/keys.ts`**: `evdevToVk(code: number): number | null` — maps our
   stored evdev codes to VKs. F1–F12→0x70–0x7B, F13–F24→0x7C–0x87,
   letters→0x41+ (via their evdev codes), digits 1–9,0→0x31–0x39,0x30,
   Insert 0x2D, Home 0x24, End 0x23, PageUp 0x21, PageDown 0x22, Pause 0x13,
   ScrollLock 0x91, Grave 0xC0, Backslash 0xDC, mouse buttons BTN_LEFT
   272→0x01, BTN_RIGHT 273→0x02, BTN_MIDDLE 274→0x04, BTN_SIDE 275→0x05,
   BTN_EXTRA 276→0x06; unknown → null. `MODIFIER_VKS: Record<PttModifier,
   number[]>` = ctrl [0x11], shift [0x10], alt [0x12], super [0x5B, 0x5C].
2. **`main/windows-keys.ts`**: `createWindowsKeys(deps)` with
   `deps = { keyDown(vk: number): boolean; platform: string }` (real
   `keyDown` = koffi-loaded `GetAsyncKeyState(vk) & 0x8000`, lazy-required
   so non-win32 never loads koffi). Same structural backend shape as
   evdev/portal: `available()` (win32 && koffi loads), `bind(id, desc,
   binding)` returning BoundShortcut. 25 ms interval; edge detection with
   the same modifier semantics as evdev (activation only when modifier
   already held; modifier-up while active deactivates; key held at arm
   ignored until an up-edge — poll state starts as "up"). `bind` throws a
   clear error when `evdevToVk` returns null ("key not supported on
   Windows"). Interval cleared on close.
3. **`PttController` mute dep**: replace `exec` + `sourceId()` deps with
   one injected `mute(muted: boolean): Promise<void>` and
   `unmutePrevious?(id: string)`-free design: `rearmSource(previousSourceId)`
   becomes `rearm(previous: { unmute(): Promise<void> } | ...)` — SIMPLEST
   honest cut: keep the controller API but inject
   `muteOps: { mute(m: boolean): Promise<void>; unmuteById(id: string): Promise<void> }`.
   Linux impl: pactl (byte-identical behavior). Windows impl: OBS
   `SetInputMute` on `'AxiStream Mic'`; `unmuteById` = same input unmute
   (device-id irrelevant for OBS-level mute).
4. **Selection** (index.ts): `process.platform === 'win32'` → windows-keys
   backend, mode `'passthrough'`, OBS muteOps. Linux unchanged (evdev/portal
   + pactl muteOps).
5. **Packaging**: `koffi` in app `dependencies`; appended to
   `optionalNatives` in electron.vite.config.ts (same pattern as usocket);
   `npm run build` gate proves the bundle.

## Testing

- `evdevToVk` table spot-checks (F18→0x81, V→0x56, '1'→0x31, PageUp→0x21,
  BTN_SIDE→0x05, unknown 999→null); `MODIFIER_VKS` values.
- windows-keys with fake `keyDown`: press/release edges fire
  onActivated/onDeactivated; modifier gating (late modifier no-op,
  modifier-up deactivates, either super VK counts); repeat polls while held
  fire nothing; close stops polling; bind rejects unmappable code;
  available() false off-win32.
- PttController: existing tests updated to muteOps injection; Linux pactl
  muteOps unit (same commands as before); Windows muteOps issues
  SetInputMute on 'AxiStream Mic'.
- Full suite + both tsc gates + `npm run build` (koffi external).

## Not in scope

MumbleLink/NVENC (next items); real-hardware validation; UI copy changes.
