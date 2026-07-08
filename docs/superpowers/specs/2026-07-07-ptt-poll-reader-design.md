# PTT Evdev Poll Reader + Rebind Feedback — Design

**Date:** 2026-07-07
**Status:** Approved in conversation (root cause debugged live with the user).
**Scope:** Fix the evdev pass-through backend going silent when many input
devices are readable, and make the press-to-bind capture honest about
timeouts and cancellation. No behavior change to the portal (exclusive)
backend, PttController, or backend selection.

## Root cause (debugged 2026-07-07)

`evdev-keys.ts` reads `/dev/input/event*` with `fs.createReadStream`. Its
blocking reads run on libuv's threadpool, which defaults to **4 threads**.
The pass-through unlock (udev uaccess rule) makes **~43 devices** readable;
43 never-returning blocking reads starve the pool and every stream goes
silent — PTT and press-to-bind both receive zero events while a raw
non-blocking reader on the same nodes sees everything. Reproduced in plain
Node (43 streams: process wedges; 1 stream: works) and fix-validated with a
non-blocking poll reader (43 devices armed, all injected KEY_F18 events
captured).

Historical note: pass-through "worked, then died" because early on only ~4
devices were readable (fits the pool); the unlock widening access to all
devices is what killed it — not the settable-hotkey feature it coincided
with. Also found: the user's G502 emits KEY_ESC (code 1) from one button,
which silently cancels capture, and capture's 10 s timeout was invisible.

## Design

### 1. `pollStream` replaces `createReadStream` — `evdev-keys.ts`

A poll-based reader with the exact `openStream` interface `EvdevDeps`
already defines, so `bind`/`captureNextKey` and their fake-deps tests are
untouched:

- `openSync(path, O_RDONLY | O_NONBLOCK)`; a 25 ms `setInterval` sweep
  calls `readSync` until `EAGAIN` (drained), emitting each chunk to the
  `data` callback. Zero threadpool usage; ~25 ms worst-case PTT latency.
- Open failure or a read error other than `EAGAIN` (e.g. `ENODEV` on device
  unplug) emits `error` and stops the poller — `bind` already prunes
  errored streams; capture's timeout already covers dead probes.
- `destroy()` clears the interval and closes the fd.
- Exported for a fifo-based integration test (mkfifo + write frames →
  data callback fires; destroy stops delivery).

### 2. Capture outcome union — honest rebind results

`captureNextKey` currently resolves `PttKey | null`, so timeout and Esc
cancel are indistinguishable and silent. New shared type in
`shared/keys.ts`:

```ts
export type PttCaptureResult =
  | { key: PttKey }
  | { reason: 'timeout' | 'cancelled' | 'unavailable' }
```

- `captureNextKey` resolves `{ key }` on a captured keydown,
  `{ reason: 'cancelled' }` on Esc, `{ reason: 'timeout' }` on the 10 s
  timer, `{ reason: 'unavailable' }` when no devices are readable.
- **Plain mouse clicks are ignored during capture:** BTN_LEFT (272) and
  BTN_RIGHT (273) are skipped, so clicking the Rebind button (or a stray
  click) can't bind left-click as PTT. All other codes — including mouse
  side buttons and gamepad buttons — still bind (the user's PTT is a mouse
  button emitting F18).
- The `capturePttKey` IPC (main → preload → shared types) returns
  `PttCaptureResult`; main's handler patches settings only on `{ key }`.
  The disarm-during-capture and re-enable-with-intent-resample logic is
  unchanged.

### 3. Rebind UI feedback — `AudioSettings.tsx`

- While capturing: "Press any key… **Ns** (Esc cancels)" with a live
  renderer-side countdown from 10.
- After capture resolves with a reason: a short status line — timeout →
  "No key seen — timed out", cancelled → "Cancelled", unavailable →
  "Pass-through unavailable". Cleared when Rebind is clicked again.
- A captured key needs no extra message: the key name in state updates.

## Error handling

Unchanged philosophy: nothing throws out of the backend. Errored devices
are pruned (bind) or covered by the timeout (capture). The poller treats
any non-`EAGAIN` read error as device-gone.

## Testing

- `pollStream` (fifo): frames written to a mkfifo arrive via `data`
  (possibly batched); `destroy()` stops delivery; open failure emits
  `error`. Linux-only, matching the backend itself.
- `captureNextKey` (fake deps, existing pattern): keydown resolves
  `{ key }`; Esc resolves `{ reason: 'cancelled' }`; timeout resolves
  `{ reason: 'timeout' }`; no readable devices resolves
  `{ reason: 'unavailable' }`; BTN_LEFT/BTN_RIGHT keydowns are ignored and
  capture continues.
- Existing evdev/bind tests pass unchanged (interface preserved).
- Manual smoke (user): G502-F18 press activates PTT with all devices
  readable; Rebind captures a Wooting key within the countdown; letting it
  expire shows the timeout message.

## Not in scope

- Backend selection changes (portal vs evdev preference) — pass-through is
  confirmed working on the user's machine once this fix lands.
- Device filtering by EV_KEY capability (unnecessary once reads don't
  consume threads).
- Hotplug re-scan of /dev/input while a bind is armed — pre-existing
  limitation, unchanged by this fix (toggling PTT re-arms).
