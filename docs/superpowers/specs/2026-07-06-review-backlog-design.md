# Review-Backlog Cleanup — Design

**Date:** 2026-07-06
**Status:** Approved (design); pending implementation plan
**Scope:** The accepted follow-ups from tonight's three final reviews: two
small behavior hardenings and four test-coverage gaps. Sources:
`.superpowers/sdd` final-review notes for encoder-presets and
v1-robustness, and the privacy-masks review Minors.

## Items

### 1 — preferSoftware persists only after the x264 retry reaches LIVE

**Problem (encoder final review, plan-level):** `onStartFailure` patches
`preferSoftware: true` immediately. A transient network/RTMPS outage on an
NVENC box therefore permanently flips the install to software (recovery =
delete stream.json, no UI).

**Fix (in `packages/app/src/main/index.ts`):** mirror the existing
`pendingOAuthBump` pattern. `onStartFailure` still flips the in-session
`encoderKind` to `'x264'` and applies the preset for the retry, but no
longer calls `settings.patch`. It sets `pendingSoftwareFlip = true`. The
`StreamController.onPhase` callback (which already handles
`pendingOAuthBump`): on `LIVE` with the flag set →
`settings.patch({ preferSoftware: true })` and clear; on `ERROR` or
`READY` → clear without persisting. Semantics: only a retry that actually
went live proves the pipe was fine and the hardware encoder was the
problem; a failed retry (network dead) changes nothing across restarts —
next boot re-detects hardware and pays at most one more 15 s retry.
Mid-session behavior is unchanged (`encoderKind` stays `'x264'` either
way).

### 2 — Stale-option flash guard

**Problem (robustness final review):** `AudioSettings` device lists start
`[]` and fill asynchronously, so a plugged-in saved device briefly renders
"Saved device (unavailable)" on every mount.

**Fix (renderer-only):** `useState<AudioDevice[] | null>(null)` for both
lists. `staleOption` is only consulted when the list is non-null; option
mapping and the "No … devices found" empty state use `list ?? []` /
require non-null. Until first enumeration the select renders only the
(value-less) state it had — no placeholder flash.

### 3 — Test-coverage gaps (no production code changes)

- **MaskEditor drag + resize interaction test** (privacy-masks review):
  jsdom lacks `setPointerCapture` and real layout — stub
  `Element.prototype.setPointerCapture`/`releasePointerCapture` and
  define `HTMLElement.prototype.clientWidth/clientHeight` getters
  (800/450, restored after) so the editor's measured content rect is the
  element box. Drag the rect 80px right → committed `x` increases by 0.1
  with `w` unchanged; drag the resize handle → `w/h` change, `x/y` don't
  (this is the regression test for the stopPropagation adjudication).
- **MaskController cap test** (encoder-review adjacent): 10 masks in →
  exactly 8 `CreateInput` calls (the `slice(0, MAX_MASKS)` line).
- **StatChips 5% boundary** (robustness review): `droppedPct: 5` → class
  contains `warn`, not `bad` (the `> 5` inequality).
- **Mic-picker stale integration test** (robustness review): mirror of the
  desktop one — saved `micDevice` absent from enumerated list renders the
  placeholder and the select carries the saved id.

## Non-goals

macOS destroyed-window closure (deferred until macOS matters); label-lie on
OBS silent fallback (no websocket readback exists); timing-margin rework of
controller tests (green and generous).

## Error handling

Item 1: flag cleared on every terminal phase, so it can never leak into a
later session (it's process-local, never persisted). Item 2: null list is
render-local; IPC failures resolve to `[]` (existing behavior) which counts
as "loaded".

## Testing

Items 1–2 get targeted unit/render tests alongside the four gap tests:
- Item 1: extend the controller-wiring seam indirectly — test at the
  settings level is impossible (index.ts has no harness), so the plan
  asserts the behavior contract in `stream-controller`-style fashion is NOT
  possible either; instead the *pure part* is nothing — item 1 is wiring
  only. Verification: full suite + tsc + code review of the diff (same
  standard as the original pendingOAuthBump wiring, which is also
  reviewed-not-unit-tested).
- Item 2: render test — saved device present in the *eventually returned*
  list → placeholder never appears (assert `queryByText` null after
  `findByRole('option', ...)` resolves); plus the existing stale tests keep
  passing (lists resolve to arrays without the saved id → placeholder).
