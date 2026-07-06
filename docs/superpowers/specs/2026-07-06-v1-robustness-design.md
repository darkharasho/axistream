# V1 Robustness Batch — Design

**Date:** 2026-07-06
**Status:** Approved (design); pending implementation plan
**Scope:** Three small, independent hardening items that close documented
gaps: (A) single-instance lock, (B) stale audio-device fallback in the
pickers, (C) truthful stream-health chips (dropped-frame severity + idle
encoder label). Each is renderer- or main-local, no new subsystems.

## Problems

**A — Single-instance lock** (deferred in
`docs/capture-provisioning-followups.md`): two AxiStream instances fight
over the OBS sidecar — the second launch spawns a second OBS against the
same profile/collection and both break. Electron's
`app.requestSingleInstanceLock()` exists for exactly this.

**B — Stale device shows a blank select** (ticketed in the
desktop-device-picker final review): if the persisted `micDevice` /
`desktopDevice` is no longer in the enumerated list (USB DAC unplugged),
the `<select value=...>` matches no option and renders blank. The user sees
an empty control with no explanation.

**C — Health chips lie twice** (`StatChips.tsx`): the idle chip hardcodes
`x264` even though encoder presets now stream NVENC/VAAPI, and the dropped
chip is styled `good` unconditionally — 10,000 dropped frames still shows
green. The app's pitch is opinionated UX; it should say "your stream is
struggling" without the user knowing what dropped frames are.

## Non-goals

Cross-instance argument forwarding (second launch just focuses the first
window); device hot-plug re-enumeration; automatic bitrate adaptation on
drops; notification toasts; "remember not honored" detection (needs
cross-launch state — still deferred).

## Design

### A — Single-instance lock

New `packages/app/src/main/single-instance.ts`, pure-testable via injected
deps:

```ts
export interface SingleInstanceDeps {
  requestSingleInstanceLock(): boolean
  quit(): void
  on(event: 'second-instance', cb: () => void): void
}
/** True = this is the primary instance (second-instance callback armed).
 *  False = another instance owns the lock; quit() has been called. */
export function enforceSingleInstance(d: SingleInstanceDeps, onSecondInstance: () => void): boolean
```

`index.ts`: call it at the very top of the ready flow — actually before
`app.whenReady()` work begins, guard module-level:

```ts
const primary = enforceSingleInstance(
  { requestSingleInstanceLock: () => app.requestSingleInstanceLock(), quit: () => app.quit(), on: (e, cb) => app.on(e, cb) },
  () => { /* set at ready-time to showWin; see below */ },
)
if (primary) app.whenReady().then(async () => { ... existing body ... })
```

Since `showWin` only exists after the window is created, the callback
closes over a `let focusMain: () => void = () => {}` reassigned to
`showWin` inside `whenReady` (restore + show + focus — same behavior as the
tray click). Non-primary instances call `app.quit()` and never start OBS.

### B — Stale device fallback

Renderer-only, in `AudioSettings.tsx`. For each picker: when the saved
value is non-empty and not present in the enumerated list, render one extra
`<option value={saved}>Saved device (unavailable)</option>` so the select
shows the truth instead of blank. Extracted as a tiny pure helper so both
pickers share it and it's directly testable:

```ts
// packages/app/src/renderer/device-options.ts
export interface DeviceOption { id: string; name: string }
/** The saved id as a labeled placeholder when it isn't in the list, else null. */
export function staleOption(saved: string | null, devices: DeviceOption[]): DeviceOption | null
```

Returns `{ id: saved, name: 'Saved device (unavailable)' }` when `saved` is
truthy and no device matches; null otherwise. `AudioSettings` renders it
(disabled=false — picking a real device replaces it; OBS itself already
falls back internally when the id is gone, so audio keeps working).

### C — Truthful health chips

Two parts:

1. **Idle encoder label.** `AppState` gains `encoder: string`
   (INITIAL_STATE `'x264'`). `index.ts`'s `applyEncoderPreset` adds
   `setState({ encoder: currentPreset.label })` (and the `onStartFailure`
   path inherits it since it calls `applyEncoderPreset`). `StatChips`
   receives `encoder: string` and uses it in the idle chip instead of the
   hardcoded literal. `StreamScreen` passes `state.encoder`.

2. **Dropped-frame severity.** `LiveStats` gains `droppedPct: number`.
   `StreamController.mapStats` computes it from OBS's
   `outputSkippedFrames / outputTotalFrames` (0 when total is 0/absent),
   rounded to one decimal. `StatChips` styles the dropped chip by
   threshold: `good` < 1%, `warn` 1–5%, `bad` > 5%, and appends the
   percentage when ≥ 1% (e.g. `342 dropped · 2.3%`). CSS: `.chip.warn`
   (amber) and `.chip.bad` (red) alongside the existing `.chip.good`.

## Error handling

A: if `requestSingleInstanceLock` throws (never observed), treat as primary
— worst case is today's behavior. B: pure function, no failure modes. C:
missing/zero `outputTotalFrames` → `droppedPct: 0`; thresholds only ever
change a CSS class and a suffix string.

## Testing

- **`single-instance`**: primary path (lock true → returns true, callback
  registered, quit not called); secondary path (lock false → quit called,
  returns false); second-instance event invokes the forwarded callback.
- **`device-options.staleOption`**: saved null → null; saved present in
  list → null; saved missing → placeholder with saved id; empty list +
  saved → placeholder.
- **`AudioSettings`** (render): stale desktop device renders the
  unavailable option and the select shows it; picking a real device still
  calls `setDesktopDevice`.
- **`StreamController`**: `droppedPct` computed from skipped/total; 0 when
  total absent.
- **`StatChips`** (render): idle chip shows passed encoder label; dropped
  chip class flips at 1% and 5%; percentage suffix appears ≥ 1%.
- **Fixtures**: `AppState.encoder` added where state objects are hand-built.
- **Manual smoke:** launch a second `npm run dev` instance — it exits and
  the first window focuses.
