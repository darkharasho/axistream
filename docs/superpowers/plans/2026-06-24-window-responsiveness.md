# App Window Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Size the app window to 60% of the active monitor's work area (inheriting its aspect ratio), with an 820×560 floor and centered placement, replacing the hardcoded 960×620.

**Architecture:** A pure `computeWindowSize(workArea, fraction, min)` helper (`packages/app/src/main/window-size.ts`) does the math; `createWindow()` reads the active display's work area from Electron's `screen` module and applies the computed size plus `minWidth`/`minHeight` and `center` to the `BrowserWindow`. A short CSS reflow audit confirms the already-fluid layout holds at the narrow and ultrawide extremes.

**Tech Stack:** TypeScript ESM (`.js` import specifiers), Electron main process (`screen`, `BrowserWindow`), Vitest (jsdom, globals, forks pool maxForks 2), React renderer + plain CSS.

## Global Constraints

- TypeScript ESM: all relative imports use `.js` specifiers even for `.ts` files (e.g. `import { computeWindowSize } from './window-size.js'`).
- App tests run via `npm test` from `packages/app` (vitest config: jsdom env, globals on, `pool: 'forks'`, `maxForks: 2`). Do NOT pass `--maxWorkers` (throws on this vitest version). Tests live in `packages/app/test/*.test.ts`.
- Policy (verbatim from spec): initial size = **60%** of the active display work area, same fraction both axes (aspect preserved); minimum **820×560** (used as both the compute floor and the window `minWidth`/`minHeight`); active display = the one under the cursor (`screen.getDisplayNearestPoint(screen.getCursorScreenPoint())`); window centered; `resizable` left at Electron default (`true`); no size/position persistence.
- Constants: `WINDOW_FRACTION = 0.6`, `WINDOW_MIN = { width: 820, height: 560 }`.
- `computeWindowSize` formula: `width = Math.max(min.width, Math.round(workArea.width * fraction))`, `height = Math.max(min.height, Math.round(workArea.height * fraction))`. Integer-valued, total, never throws.
- Preserve ALL existing `BrowserWindow` options when editing `createWindow` (`frame: false, transparent: true, backgroundColor: '#00000000', show: false, icon, webPreferences`).

---

### Task 1: `computeWindowSize` pure helper

**Files:**
- Create: `packages/app/src/main/window-size.ts`
- Test: `packages/app/test/window-size.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (Task 2 relies on these exact names/types):
  - `interface Size { width: number; height: number }`
  - `function computeWindowSize(workArea: Size, fraction: number, min: Size): Size`

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/window-size.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeWindowSize } from '../src/main/window-size.js'

const MIN = { width: 820, height: 560 }

describe('computeWindowSize', () => {
  it('scales a 16:9 work area to 60%, preserving aspect ratio', () => {
    expect(computeWindowSize({ width: 2560, height: 1400 }, 0.6, MIN)).toEqual({ width: 1536, height: 840 })
  })

  it('scales an ultrawide work area to 60%, preserving the wide ratio', () => {
    expect(computeWindowSize({ width: 3440, height: 1400 }, 0.6, MIN)).toEqual({ width: 2064, height: 840 })
  })

  it('applies the floor on both axes for a small work area', () => {
    expect(computeWindowSize({ width: 1366, height: 728 }, 0.6, MIN)).toEqual({ width: 820, height: 560 })
  })

  it('clamps only the axis that falls below the floor', () => {
    // 2560*0.6 = 1536 (>= 820, kept); 800*0.6 = 480 (< 560, floored)
    expect(computeWindowSize({ width: 2560, height: 800 }, 0.6, MIN)).toEqual({ width: 1536, height: 560 })
  })

  it('never returns below the floor at the exact boundary', () => {
    // 1366*0.6 = 819.6 -> round 820 (== floor); 933*0.6 = 559.8 -> round 560 (== floor)
    expect(computeWindowSize({ width: 1366, height: 933 }, 0.6, MIN)).toEqual({ width: 820, height: 560 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/app && npm test -- window-size`
Expected: FAIL — module `../src/main/window-size.js` not found / `computeWindowSize` not exported.

- [ ] **Step 3: Implement `computeWindowSize`**

Create `packages/app/src/main/window-size.ts`:

```ts
export interface Size { width: number; height: number }

/** Window size = workArea * fraction on both axes (preserving aspect ratio),
 *  with each axis clamped up to the min floor. Integer-valued; never throws. */
export function computeWindowSize(workArea: Size, fraction: number, min: Size): Size {
  return {
    width: Math.max(min.width, Math.round(workArea.width * fraction)),
    height: Math.max(min.height, Math.round(workArea.height * fraction)),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/app && npm test -- window-size`
Expected: PASS — all five cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/window-size.ts packages/app/test/window-size.test.ts
git commit -m "feat(app): proportional window-size helper with min floor"
```

---

### Task 2: Wire proportional sizing into `createWindow` + CSS reflow audit

**Files:**
- Modify: `packages/app/src/main/index.ts` (import `screen` + `computeWindowSize`; add constants; replace hardcoded `width: 960, height: 620`)
- Modify (only if a checkpoint visibly breaks): `packages/app/src/renderer/styles.css`

**Interfaces:**
- Consumes from Task 1: `computeWindowSize(workArea: Size, fraction: number, min: Size): Size` from `./window-size.js`, where `Size = { width: number; height: number }`. Electron's `Display.workArea` is a `{ x, y, width, height }` rectangle — its `width`/`height` satisfy `Size` structurally.
- Produces: a `createWindow()` that opens a proportional, floored, centered window. No new exported symbols.

**Note on testing:** the wiring lives in the Electron main entrypoint, which has no unit harness (the `screen`/`BrowserWindow` calls require a running Electron app). Verification is a typecheck + the existing app suite (must stay green) + a manual smoke. The CSS audit is a visual checkpoint pass.

- [ ] **Step 1: Add imports**

Modify `packages/app/src/main/index.ts` — extend the existing `electron` import (line 1) to include `screen`:

```ts
import { app, BrowserWindow, ipcMain, safeStorage, dialog, session, Tray, Menu, nativeImage, screen } from 'electron'
```

Add an import for the helper alongside the other `./` main imports (e.g. after the `CaptureConfig`/`CaptureService` imports, near line 24-25):

```ts
import { computeWindowSize } from './window-size.js'
```

- [ ] **Step 2: Add the sizing constants**

Modify `packages/app/src/main/index.ts` — directly after the `CAPTURE_SOURCE` constant (currently line 32), add:

```ts
const WINDOW_FRACTION = 0.6
const WINDOW_MIN = { width: 820, height: 560 }
```

- [ ] **Step 3: Compute the size and apply it in `createWindow()`**

Modify `packages/app/src/main/index.ts` — in `createWindow()` (currently starts line 35). Insert the size computation as the first statement inside the function, then replace the hardcoded dimensions in the `BrowserWindow` options.

Insert before `const win = new BrowserWindow({`:

```ts
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { width, height } = computeWindowSize(display.workArea, WINDOW_FRACTION, WINDOW_MIN)
```

Then replace this options line (currently line 41):

```ts
    width: 960, height: 620, frame: false, transparent: true, backgroundColor: '#00000000', show: false,
```

with (proportional size + floor + centered; all other options unchanged):

```ts
    width, height, minWidth: WINDOW_MIN.width, minHeight: WINDOW_MIN.height, center: true,
    frame: false, transparent: true, backgroundColor: '#00000000', show: false,
```

- [ ] **Step 4: Typecheck the app package**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: no type errors. (If `tsc` reports no project config, run `npm run build` instead and expect a clean build.)

- [ ] **Step 5: Run the app test suite to confirm no regression**

Run: `cd packages/app && npm test`
Expected: PASS — all existing test files plus `window-size` still green (no existing test asserts the 960×620 size).

- [ ] **Step 6: CSS reflow audit — narrow extreme (~820px width)**

Inspect `packages/app/src/renderer/styles.css`. The layout is already fluid (`.sidebar { width: 200px }` fixed, `.hero { flex: 1 }`, `.preview-video { object-fit: cover }`). At 820px total width the hero is ~620px wide. Check `.hero-top { padding: 0 120px 0 16px }` (line 65): the `120px` reserves space for the floating window controls (`.wctl`, top-right). 620px content − 136px padding = ~484px for the title/badges row — adequate, no change required.

Decision rule: only if you can demonstrate the title row visibly clips/wraps at 820px, reduce the right padding from `120px` to `96px`. Otherwise leave it unchanged. Record the decision in the report.

- [ ] **Step 7: CSS reflow audit — ultrawide extreme**

Check the two intentional content-width caps for "stranded at left edge" on a very wide window:
- `.settings-inner { max-width: 520px; padding: 26px }` (line 100) — lives in `.settings-panel` (`display: block`). It is left-aligned by design (a settings column). This is acceptable (settings columns are conventionally left-aligned); leave unchanged unless the spec reviewer flags it.
- `.hero.setup p { max-width: 360px }` (line 60) — `.hero.setup` is `align-items: center; justify-content: center; text-align: center`, so the capped paragraph is already centered within the hero. No change required.

Record findings in the report. Make a CSS edit ONLY if a checkpoint visibly breaks; if you edit, keep it minimal and re-run `npm test` (Step 5) afterward.

- [ ] **Step 8: Manual smoke (local, real Electron)**

Run the app (`cd packages/app && npm run dev`). Confirm: the window opens centered at ~60% of your monitor and matches its aspect ratio (ultrawide opens ultrawide-shaped); dragging the window edge inward stops at 820×560; the sidebar, hero/preview, and Settings screen all look right. (This step cannot run in a headless/CI environment — note it as manually verified or deferred in the report.)

- [ ] **Step 9: Commit**

```bash
git add packages/app/src/main/index.ts packages/app/src/renderer/styles.css
git commit -m "feat(app): size window proportional to monitor with min floor + centered"
```

(If no CSS edit was needed, `git add` only `packages/app/src/main/index.ts`.)

---

## Self-Review

**1. Spec coverage:**
- "Initial size = 60% of active display work area, aspect preserved" → Task 1 `computeWindowSize` + Task 2 Step 3. ✓
- "Minimum 820×560, as compute floor AND window minWidth/minHeight" → Task 1 floor (tests) + Task 2 Step 3 `minWidth/minHeight`. ✓
- "Active display = under cursor" → Task 2 Step 3 `getDisplayNearestPoint(getCursorScreenPoint())`. ✓
- "Centered" → Task 2 Step 3 `center: true`. ✓
- "Resizable stays default; no persistence" → nothing added that disables resize or persists size; constants/wiring only. ✓
- "Preserve all existing BrowserWindow options" → Task 2 Step 3 keeps `frame/transparent/backgroundColor/show/icon/webPreferences`. ✓
- "CSS reflow audit with named checkpoints, fix only if broken" → Task 2 Steps 6–7 (hero-top padding, settings-inner, hero.setup p). ✓
- "Unit tests for computeWindowSize (16:9, ultrawide, small floor, boundary)" → Task 1 Step 1 (5 cases incl. mixed-axis clamp). ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code; CSS steps give explicit decision rules and exact line references rather than vague "make it responsive". ✓

**3. Type consistency:** `Size` and `computeWindowSize(workArea, fraction, min)` identical across Task 1 (definition + tests) and Task 2 (consumption). `WINDOW_FRACTION`/`WINDOW_MIN` names consistent between Global Constraints and Task 2 Steps 2–3. Electron `Display.workArea` confirmed structurally compatible with `Size`. ✓

**Out of scope (deferred, per spec):** saved size/position memory, per-monitor DPI font scaling, hot-unplug repositioning.
