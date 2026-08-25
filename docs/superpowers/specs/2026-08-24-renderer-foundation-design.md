# Renderer Foundation — Toasts, Error Boundaries, Accessibility Floor — Design

**Date:** 2026-08-24
**Status:** Approved, ready for implementation plan
**Parent:** [1.0 Release Master Plan](./2026-08-24-v1.0-release-design.md) — sub-project 1 of 7

## Problem

The renderer has no channel for reporting non-fatal failure. The only two patterns are
full-screen `.overlay` pills for phase-level state and a 1.5s "Copied!" label. Everything
else either renders inline next to a control or vanishes.

Three consequences, in descending order of severity:

1. **A React throw is unrecoverable.** There is no error boundary anywhere, so any
   rendering error blanks the window. Because main owns OBS, the stream is almost
   certainly still running at that moment — the user just loses all visibility and
   control of it, with no way back short of killing the app.
2. **Update failures are invisible.** `UpdateStatus.error` is rendered only inside
   `UpdatesSettings`. A user not sitting on the Settings screen when an update fails never
   learns that it did.
3. **Spontaneous failures have nowhere to go.** Background plugin installs and the
   detached Discord announce fail silently by construction.

Two smaller items ride along because they are the same files: three byte-identical error
styles (`yt-test-err`, `ptt-err`, `audio-test-err` — all `12px/600/#f85149`) defined
separately, and an accessibility floor consisting of exactly one `:focus` rule in the
whole stylesheet, with `MaskEditor` having no keyboard handling at all.

## Goal

Give the renderer a non-fatal error channel, make a renderer crash recoverable without
endangering a live stream, and establish the keyboard/focus baseline — as foundation the
remaining six sub-projects consume, not as a design system.

## Non-goals

This sub-project is deliberately small. It does not migrate the existing `.overlay` system
or the existing inline field errors to toasts; both remain correct where they are.

## Decisions

Four decisions were settled during brainstorming and constrain everything below.

**Toasts are an additional channel, not a replacement.** Failures attached to a control the
user is looking at (the Discord webhook test, the audio test, a PTT bind error) stay inline
next to that control, because that is where the feedback belongs. Toasts carry failures
that occur when the user is *not* looking at the responsible control.

**Both main and the renderer can raise toasts, but `AppState` remains the default.** The
governing rule: **conditions live in `AppState`; the toast channel carries only discrete
events.** "Reconnecting…" is a condition and stays where it is. A plugin install that just
failed is an event. This rule is what keeps the channel from degrading into a second,
parallel description of application state.

Corollary, accepted knowingly: best-effort OBS failures continue to go to `console.warn`
and remain invisible to users. Surfacing them is sub-project 2's job (diagnostics export),
not the toast channel's — wiring the OBS layer's liberal warnings to toasts would make the
app nag.

**Error boundaries nest: root plus per-screen.** A crash inside a Settings panel must not
cost the user the live badge and the End Stream button.

**The accessibility floor covers focus, announcement, and modal keyboard behavior** —
but not keyboard-operable masks, which need a selection model `MaskEditor` does not have.
That work folds into sub-project 4, whose webcam positioning UI reuses the same machinery
and so gets designed once with both consumers known.

## Architecture

### 1. Toast store

New `src/renderer/toasts.ts`. Follows the existing store pattern — a module-level store
consumed via `useSyncExternalStore` — rather than introducing React Context, which the
codebase does not currently use anywhere.

```ts
createToastStore(): {
  subscribe(fn: () => void): () => void
  getToasts(): Toast[]
  push(payload: ToastPayload): string   // returns the toast id
  dismiss(id: string): void
}
```

Exports `createToastStore` for tests and a module-level singleton for app use.

The payload shape lives in `src/shared/state.ts` so main and renderer agree on it:

```ts
export interface ToastPayload {
  kind: 'info' | 'success' | 'error'
  message: string   // human-readable, one line
  detail?: string   // technical string (OBS error, HTTP status), rendered smaller
}
export interface Toast extends ToastPayload { id: string }
```

No action buttons. Callbacks are not serializable across IPC, and nothing in scope needs
one.

**Dismissal policy:**

- `info` and `success` auto-dismiss after **4000ms**.
- `error` is **sticky** — it stays until explicitly dismissed. An error that disappears
  before it is read is equivalent to no error at all.
- Every toast has a manual dismiss control regardless of kind.
- The stack caps at **3**; pushing a fourth evicts the oldest.

### 2. Toast host

New `src/renderer/components/ToastHost.tsx`, mounted once in `App.tsx`.

**Placement is constrained on three sides** and must not be decided casually:

- Bottom-centre is taken by `.overlay` (`inset: auto 0 130px`, `z-index: 3`) and by the
  `hero-bottom` block holding Go Live / End Stream.
- Top-right is taken by the window controls (`.wctl`, `z-index: 10`).
- The top strip is the drag handle (`.dragbar`, 46px, `z-index: 5`).

The stack therefore renders **top-right, offset below `.wctl`**, at `z-index: 8` — above
the preview and the `.overlay` pills, below the window controls so close and minimise stay
clickable while a toast is showing. Toasts must also carry `-webkit-app-region: no-drag`,
since they sit within the drag strip's horizontal band.

Announcement roles: `role="status"` for `info`/`success`, `role="alert"` for `error`.

### 3. Main → renderer channel

Add `CH.evtToast = 'axi:evt:toast'` to the channel map in `src/shared/state.ts`, exposed
on the preload API as `onToast(cb)` — mirroring the existing `onUpdateStatus` shape.

New `src/main/toast.ts`: a small helper that sends a `ToastPayload` to the main window,
no-op when the window is absent or destroyed.

Call sites wired in this sub-project, a deliberately closed list:

| Site | Kind | Rationale |
|---|---|---|
| Updater error | `error` | Currently invisible outside the Settings screen. |
| Discord announce failure on go-live | `error` | Detached and silent by construction today. |
| Game-audio plugin install failed / completed | `error` / `success` | Completes in the background. |
| Blur plugin install failed / completed | `error` / `success` | Completes in the background. |

Anything not on this list stays as it is. Expanding the list is a later sub-project's
decision, made against the conditions-vs-events rule.

### 4. Error boundaries

New `src/renderer/components/ErrorBoundary.tsx` — a class component, since
`componentDidCatch` requires one.

```ts
interface Props { label: string; root?: boolean; children: ReactNode }
```

Mounted as a root instance wrapping the app shell, plus one instance around each of the
Stream and Settings screens.

**Fallback UI.** Leads with stream state, because that is the question actually in the
user's head at that moment:

> **Something broke in Settings.**
> Your stream is still running.

The second line is conditional on the live phase, and must not be shown when not live.
Two actions:

- **Reload** — for a per-screen boundary, resets boundary state and re-renders the
  subtree; for the root boundary, `location.reload()`. Either way main is untouched, OBS
  keeps streaming, and the renderer re-syncs through the existing `getInitialState` call
  in `App.tsx`'s mount effect.
- **Copy error details** — error message, component stack, and app version, copied via the
  existing main-process `axi.copyToClipboard`. **Not** `navigator.clipboard`: that is
  precisely the shortcut the copy-link feature had to walk back in PR #12.

There is deliberately **no "Restart app" button**, though `relaunchApp` exists. Restarting
is the single action most likely to actually cost someone a live broadcast, so it must not
be the button under the cursor of a panicking user.

**Supporting refactor.** The boundary needs to read the live phase, but `store` is
currently created in `App.tsx` module scope and never exported. Move the singleton into
`store.ts` as an export, keeping `createStore` exported for tests. `App.tsx` imports the
singleton instead of constructing it.

### 5. Field error unification

Replace the three identical classes with a single `.field-err`, updating `YouTubeSettings`,
`AudioSettings`, and the PTT error line. Keep the `user-select: text` affordance those
classes carry today — error text must stay selectable.

`setup-error` is **not** folded in. It is visually distinct (large hero text, `#fecdd3`)
and serves a different context.

### 6. Accessibility floor

- **Global `:focus-visible`** ring on the accent colour (`#22d3ee`), replacing the single
  existing `.keypicker-grid input:focus` rule with a baseline that applies app-wide.
- **`useModalKeys` hook** (`src/renderer/use-modal-keys.ts`): Escape invokes the close
  callback, focus is trapped within the container while open, and focus is restored to the
  previously focused element on unmount. Applied to `TitlePromptModal` (which has
  `autoFocus` and Enter-to-submit today but no Escape) and to `MaskEditor` (no keyboard
  handling at all — currently only leavable by locating Done with a mouse).
- **Icon-only button label audit.** Spot-checked during design: window controls and sidebar
  quick toggles already carry `aria-label`. Expected to be a small pass.

## Data flow

Main-originated toast:

```
failure in main  →  toast(win, payload)  →  CH.evtToast  →  preload onToast
                 →  toastStore.push()    →  ToastHost re-renders via useSyncExternalStore
```

Renderer-originated toast: components call `toastStore.push()` directly. Same store, same
host, no IPC.

Renderer crash:

```
child throws  →  nearest ErrorBoundary catches  →  fallback reads store.getState().phase
              →  live-aware message + Reload / Copy details
              →  Reload resets subtree; App's mount effect re-syncs via getInitialState
```

## Testing

- **`toasts.test.ts`** — push returns an id; dismiss by id removes; fake-timer auto-dismiss
  at 4s for info and success; **errors do not auto-dismiss**; stack evicts the oldest at 3.
- **`toast-host.test.tsx`** — `role="status"` versus `role="alert"` by kind; `detail`
  renders when present and is absent otherwise; the dismiss control removes the toast.
- **`error-boundary.test.tsx`** — catches a throwing child and renders the fallback; shows
  "Your stream is still running" when the phase is `LIVE` and omits it otherwise; Reload
  recovers the subtree; Copy error details calls `copyToClipboard` with a payload
  containing the message and the version.
- **`modal-keys.test.tsx`** — Escape fires the close callback; Tab is trapped inside the
  container; focus returns to the trigger on unmount.
- **`ipc-contract.test.ts`** — extend the existing contract test to cover `evtToast`.

Gates before merge, per project convention: `npm -w @axistream/app run test`,
`npm -w @axistream/capture run test`, and
`cd packages/app && npx tsc --noEmit -p tsconfig.json`.

## Out of scope (YAGNI)

- Toast action buttons, queuing, deduplication, or per-toast progress.
- Migrating the `.overlay` system to toasts (conditions, not events).
- Migrating inline field errors to toasts.
- Keyboard-operable masks (deferred to sub-project 4).
- Theming, light mode, or motion-preference handling.
- Wiring the best-effort OBS warning layer to toasts.
