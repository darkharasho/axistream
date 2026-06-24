# App Window Responsiveness — Design

**Date:** 2026-06-24
**Status:** Approved (design), pending plan
**Scope:** Piece **B** of the "account for different screen resolutions" work. Piece **A** (capture/stream resolution) shipped on `main` (commit `e69cb4f`).

## Problem

The app window opens at a hardcoded `960×620` regardless of the display (`packages/app/src/main/index.ts:41`). On a large or ultrawide monitor it looks tiny and assumes a ~16:9 shape that doesn't match the screen. There is also no minimum size, so the frameless window can be dragged down to an unusable sliver.

## Goal

Size the window **proportionally to the detected monitor's work area** so it inherits the monitor's aspect ratio (16:9 → smaller 16:9; ultrawide → ultrawide-shaped; 4:3 → 4:3), with a usability floor below which it cannot shrink. The window remains freely resizable during a session and re-derives its size from the monitor on each launch (no saved-size memory).

## Policy (decided)

- **Initial size = 60% of the active display's work area**, same fraction on both axes (so aspect ratio is preserved).
- **Minimum size = 820×560.** Applied both as the computed-size floor and as the window's `minWidth`/`minHeight`.
- **Active display = the one under the cursor at launch** (`screen.getDisplayNearestPoint(screen.getCursorScreenPoint())`), not necessarily the OS primary.
- **Centered** on that display.
- **Resizable** stays at Electron's default (`true`). No size/position persistence (YAGNI — the policy re-derives from the monitor each launch).

## Architecture

### New pure helper: `packages/app/src/main/window-size.ts`

```ts
export interface Size { width: number; height: number }

/** Window size = workArea * fraction on both axes (preserving aspect ratio),
 *  with each axis clamped up to the min floor. Integer-valued. */
export function computeWindowSize(workArea: Size, fraction: number, min: Size): Size
```

- `width = Math.max(min.width, Math.round(workArea.width * fraction))`
- `height = Math.max(min.height, Math.round(workArea.height * fraction))`
- Both axes scale by the same `fraction`, so the result inherits the work area's aspect ratio. The `min` floor only engages on small/low-res displays, where usability outranks exact aspect.
- Pure, no Electron import → fully unit-testable.

### Wiring in `createWindow()` (`packages/app/src/main/index.ts`)

- Add module-level constants near the top of `index.ts`:
  ```ts
  const WINDOW_FRACTION = 0.6
  const WINDOW_MIN = { width: 820, height: 560 }
  ```
- Import `screen` from `electron` and `computeWindowSize` from `./window-size.js`.
- In `createWindow()` (runs inside `app.whenReady().then(...)`, so `screen` is available):
  ```ts
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { width, height } = computeWindowSize(display.workArea, WINDOW_FRACTION, WINDOW_MIN)
  ```
- Pass `width`, `height`, `minWidth: WINDOW_MIN.width`, `minHeight: WINDOW_MIN.height`, and `center: true` to the `new BrowserWindow({...})` options (replacing the hardcoded `width: 960, height: 620`). All existing options (`frame: false, transparent: true, backgroundColor, icon, webPreferences`, etc.) are preserved.

### CSS reflow audit (`packages/app/src/renderer/styles.css`)

The layout is already fluid: `.sidebar { width: 200px }` fixed, `.hero { flex: 1 }`, `.preview-video { object-fit: cover }`, `clip-path`/`border-radius` are size-independent. This is therefore a **verification pass with named checkpoints**, fixing only what visibly breaks at the two extremes (narrow ~820px and ultrawide):

- `.hero-top { padding: 0 120px 0 16px }` — the `120px` reserves room for the floating window controls. Confirm the title isn't crowded at 820px width; if it is, reduce the right padding to a safe value (e.g. `96px`).
- `.settings-inner { max-width: 520px }` and `.hero.setup p { max-width: 360px }` — intentional content-width caps. Confirm they read as centered (not stranded at the left edge) on an ultrawide; add centering (e.g. `margin: 0 auto`) if they look stranded.
- Rounded-corner `clip-path: inset(0 round 10px)` + hero/preview `border-radius` — confirm corners still hug at large sizes (expected fine; size-independent).

## Data flow

```
app.whenReady → createWindow()
  └─ screen.getCursorScreenPoint → getDisplayNearestPoint → display.workArea {w,h}
       └─ computeWindowSize(workArea, 0.6, {820,560}) → {width,height} (aspect-preserved, floored)
            └─ new BrowserWindow({ width, height, minWidth:820, minHeight:560, center:true, ... })
```

## Error handling

`computeWindowSize` is total — for any positive work area it returns a valid floored size; it never throws. If Electron's `screen` returned an unexpectedly tiny or zero work area, the min floor guarantees a usable 820×560. No try/catch needed; there is no async or external call.

## Testing

**Unit (`packages/app/test/window-size.test.ts`):** `computeWindowSize`
- 16:9 work area `2560×1400` → `1536×840` (ratio preserved)
- ultrawide work area `3440×1400` → `2064×840` (wide ratio preserved)
- small work area `1366×728` → `820×560` (floor applied on both axes)
- exact-floor boundary: work area that scales to exactly `820×560` stays there; one pixel under stays at floor (never below)

**Wiring:** no unit test (Electron main entrypoint has no harness). Covered by manual smoke — launch on the ultrawide and confirm: window opens ~60% and ultrawide-shaped, centered; cannot be dragged below 820×560; layout (sidebar, hero, preview, settings) looks right at both narrow and ultrawide widths.

## Out of scope (this spec)

- Saved window size/position memory across launches (deliberately omitted; re-derive each launch).
- Per-monitor DPI font scaling beyond what the OS/Chromium already applies.
- Repositioning the window when a monitor is hot-unplugged mid-session.
- The capture/stream resolution feature (piece A — already shipped).
