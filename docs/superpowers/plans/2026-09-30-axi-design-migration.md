# axistream axi-design Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate axistream fully onto `@axiapps/axi-design`: the language's stylesheet, the accent system, all three surfaces, and its components wherever the language has a counterpart — ending with zero colour literals in `src/renderer/styles.css`.

**Architecture:** Six tasks in dependency order, each leaving a launchable app. Adopt the package and wire the appearance pickers first (tokens become available, nothing looks different). Then the accent, so the app's 21 hardcoded cyans follow `--axi-accent`. Then the shell, which is where the one behavioural change lives — the window radius becomes a token, and the rounded-video compositing workaround has to follow it. Then component swaps, then the literal sweep to zero, then the three inline-`style` components.

**Tech Stack:** Electron + React + TypeScript, electron-vite, npm workspaces (`packages/app`), vitest (jsdom, tests in `packages/app/test/`), `@axiapps/axi-design@^1.43.0`.

**Spec:** `docs/superpowers/specs/2026-09-30-axi-design-migration-design.md` (this repo)

## Global Constraints

- **Prerequisite:** `@axiapps/axi-design@1.43.0` must be published first — it carries the `electric-cyan` accent. See `axi-design/docs/superpowers/plans/2026-09-30-surface-picker-rollout.md` Task 1. Verify with `npm view @axiapps/axi-design version` before starting.
- **Default accent is `electric-cyan`**, default surface is `axi`. A first launch after migration must look essentially unchanged.
- **The three surface ids are exactly `'axi' | 'flat' | 'glass'`**, labelled `Axi`, `Flat`, `Glass`. `'axi'` **removes** `data-axi-theme`; it never sets `data-axi-theme="axi"`.
- **Both attributes go on `document.documentElement`** (`<html>`), never `<body>`.
- **Stylesheet import order:** `axi.css`, `accents.css`, `themes/flat.css`, `themes/glass.css`, then `./styles.css`.
- **End state: zero hex colour literals in `src/renderer/styles.css`.** Enforced by a test in Task 5.
- **The one sanctioned exception** is black-over-video legibility scrims — `rgba(0,0,0,…)` and `rgba(255,255,255,…)` in the `.hero-*`, `.preview-*`, `.overlay*`, `.wbtn`, `.badge`, `.pill` and `.chip` rules that sit over moving pixels. These are legibility devices, not surfaces. They are `rgba()` functions, not hex literals, so the guard passes by construction.
- **No change to axi-design.** If the migration wants something the language lacks, the answer is a local rule painted in tokens. A new upstream component or token is a separate conversation with its own review, because `docs/RULES.md` makes a new capability cost a main-theme token and a look in every theme.
- **`-webkit-app-region` declarations are behaviour, not appearance.** They stay local wherever they are, including on `.axi-rail`.
- **Vitest runs at 2 forks max** — `packages/app/vitest.config.ts` already pins `maxForks: 2`. Never raise it.
- **Do not adopt `.axi-titlebar`.** axistream has no titlebar; `.dragbar` is an invisible absolute drag overlay. See Task 3.
- **Do not adopt `.axi-window` for `.app`.** `.axi-window` is a column flex; `.app` is a row.

## Review Focus

Input classes and conditions the spec implies but that no happy path exercises. Each has a test or an explicit verification assigned.

1. **The window radius under each surface.** `--axi-radius` is 16px under glass and 6px under flat. Seven radius values across five selectors must all follow, or the composited `<video>` corners disagree with the frame. No test in this repo can see a composited layer — Task 3 adds a stylesheet assertion that no bare `10px` radius survives, and a mandatory by-eye check with a live capture under all three surfaces.
2. **A stored accent or surface id from a future or downgraded version.** `localStorage` outlives the app version. `resolveAccentId('ultraviolet')` and `resolveSurfaceId('frosted')` must return defaults, and inherited property names must not reach the prototype chain. Tested in Task 1.
3. **`localStorage` throwing** (storage disabled by policy). The app must still paint and still apply the chosen appearance for the session. Tested in Task 1.
4. **Focus rings after the global `:focus-visible` override is removed.** That one local rule currently overrides the language's focus ring on every element; deleting it changes focus appearance app-wide, including inside the three inline-style components that no stylesheet reaches. Tested in Task 2 by assertion, verified by keyboard in Task 6.
5. **The accent applied before first paint.** `applySurface`/`applyTheme` run at module scope in `main.tsx` before `createRoot`. If they ran after render, the app would paint on Axi/default and visibly flip. Tested in Task 1 by asserting the attributes are set by importing the entry's bootstrap, and checked by eye on every launch thereafter.

---

## File Structure

All paths relative to `packages/app/` unless noted.

**Task 1 — adopt**
- Create: `src/renderer/appearance.ts` — the accent and surface pair; the only module that touches `localStorage` or the two root attributes
- Create: `src/renderer/components/AppearanceSettings.tsx` — the picker panel, one component like the other nine
- Create: `test/appearance.test.ts`
- Modify: `package.json` (dep), `src/renderer/main.tsx` (imports + bootstrap), `src/renderer/styles.css` (crossfade rule), `src/renderer/components/SettingsScreen.tsx` (render the panel first in the grid)

**Task 2 — accent**
- Modify: `src/renderer/styles.css` (21 cyan occurrences; delete the `:focus-visible` override)
- Modify: `test/appearance.test.ts` (add the literal assertions for this task's scope)

**Task 3 — shell**
- Modify: `src/renderer/styles.css` (`#root`, `.app`, `.dragbar`, `.wctl`, `.wbtn`, `.sidebar` → rail, `.hero` backsplash, `.preview-*` radii)
- Modify: `src/renderer/App.tsx` (`.sidebar` → `axi-rail axi-rail--flush`), `src/renderer/components/Sidebar.tsx`
- Create: `test/styles-radius.test.ts`

**Task 4 — components**
- Modify: 20 files under `src/renderer/components/`, plus the corresponding rules in `src/renderer/styles.css`

**Task 5 — sweep**
- Modify: `src/renderer/styles.css` (remaining literals)
- Create: `test/styles-tokens.test.ts` (the zero-hex guard)

**Task 6 — inline styles**
- Modify: `src/renderer/components/MaskEditor.tsx`, `Select.tsx`, `WebcamSettings.tsx`

---

### Task 1: Adopt the package and wire both pickers

**Repo:** `axistream`, branch `axi-design-migration` (exists, holds the spec commit)

**Files:**
- Create: `packages/app/src/renderer/appearance.ts`
- Create: `packages/app/src/renderer/components/AppearanceSettings.tsx`
- Create: `packages/app/test/appearance.test.ts`
- Modify: `packages/app/package.json`, `packages/app/src/renderer/main.tsx`, `packages/app/src/renderer/styles.css`, `packages/app/src/renderer/components/SettingsScreen.tsx:18`

**Interfaces:**
- Consumes: `@axiapps/axi-design@^1.43.0` — `axi.css`, `accents.css`, `themes/flat.css`, `themes/glass.css`, `accents.json`.
- Produces, from `src/renderer/appearance.ts`:
  ```ts
  export type AccentDefinition = { id: string; label: string; hex: string }
  export type SurfaceId = 'axi' | 'flat' | 'glass'
  export const ACCENTS: AccentDefinition[]
  export const SURFACES: { id: SurfaceId; label: string }[]
  export const DEFAULT_ACCENT_ID = 'electric-cyan'
  export const DEFAULT_SURFACE_ID: SurfaceId = 'axi'
  export const ACCENT_STORAGE_KEY = 'axistream.accent'
  export const SURFACE_STORAGE_KEY = 'axistream.surface'
  export function resolveAccentId(id?: string | null): string
  export function resolveSurfaceId(id?: string | null): SurfaceId
  export function readAccent(): string
  export function readSurface(): SurfaceId
  export function applyAccent(id?: string | null): string
  export function applySurface(id?: string | null): SurfaceId
  export function bootAppearance(): void
  ```
  Every later task reads from this module and nothing else touches the two attributes.

axistream's house style: 2-space indent, **no semicolons**, single quotes, `.js` extensions on relative imports (it is ESM-resolved by electron-vite).

- [ ] **Step 1: Verify the prerequisite**

```bash
npm view @axiapps/axi-design version
```

Expected: `1.43.0` or higher. If it prints `1.42.0`, the rollout plan's Task 1 has not published yet — **stop**; `electric-cyan` does not exist and the default accent cannot be set.

- [ ] **Step 2: Write the failing test**

Create `packages/app/test/appearance.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ACCENTS,
  SURFACES,
  DEFAULT_ACCENT_ID,
  DEFAULT_SURFACE_ID,
  ACCENT_STORAGE_KEY,
  SURFACE_STORAGE_KEY,
  resolveAccentId,
  resolveSurfaceId,
  readAccent,
  readSurface,
  applyAccent,
  applySurface,
  bootAppearance,
} from '../src/renderer/appearance.js'

// vitest.config.ts runs jsdom, so <html> and localStorage are real.
beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-axi-accent')
  document.documentElement.removeAttribute('data-axi-theme')
  document.documentElement.classList.remove('theme-transitioning')
})

describe('the palette', () => {
  it('is the design language\'s, with electric-cyan present', () => {
    expect(ACCENTS.length).toBeGreaterThanOrEqual(12)
    const cyan = ACCENTS.find((a) => a.id === 'electric-cyan')
    expect(cyan).toBeDefined()
    expect(cyan!.hex).toBe('#22d3ee')
  })

  // The whole point of adding a twelfth accent: the app's identity colour
  // survives the migration, so a first launch looks unchanged.
  it('defaults to electric-cyan, axistream\'s identity colour', () => {
    expect(DEFAULT_ACCENT_ID).toBe('electric-cyan')
  })

  it('offers the three surfaces in order, defaulting to the language', () => {
    expect(SURFACES.map((s) => s.id)).toEqual(['axi', 'flat', 'glass'])
    expect(SURFACES.map((s) => s.label)).toEqual(['Axi', 'Flat', 'Glass'])
    expect(DEFAULT_SURFACE_ID).toBe('axi')
  })
})

// Review Focus 2
describe('resolving stored ids', () => {
  it('passes through ids it knows', () => {
    expect(resolveAccentId('axi-gold')).toBe('axi-gold')
    expect(resolveSurfaceId('flat')).toBe('flat')
    expect(resolveSurfaceId('glass')).toBe('glass')
    expect(resolveSurfaceId('axi')).toBe('axi')
  })

  it('falls back for ids from a future or downgraded version', () => {
    expect(resolveAccentId('ultraviolet')).toBe(DEFAULT_ACCENT_ID)
    expect(resolveSurfaceId('frosted')).toBe(DEFAULT_SURFACE_ID)
  })

  it('falls back for empty and absent values', () => {
    expect(resolveAccentId(null)).toBe(DEFAULT_ACCENT_ID)
    expect(resolveAccentId(undefined)).toBe(DEFAULT_ACCENT_ID)
    expect(resolveAccentId('')).toBe(DEFAULT_ACCENT_ID)
    expect(resolveSurfaceId(null)).toBe(DEFAULT_SURFACE_ID)
    expect(resolveSurfaceId('')).toBe(DEFAULT_SURFACE_ID)
  })

  it('does not reach the prototype chain', () => {
    for (const key of ['constructor', '__proto__', 'toString', 'valueOf']) {
      expect(resolveAccentId(key)).toBe(DEFAULT_ACCENT_ID)
      expect(resolveSurfaceId(key)).toBe(DEFAULT_SURFACE_ID)
    }
  })
})

describe('applying', () => {
  it('puts the accent on <html> and remembers it', () => {
    expect(applyAccent('axi-gold')).toBe('axi-gold')
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe('axi-gold')
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('axi-gold')
  })

  it('puts a surface theme on <html> and remembers it', () => {
    expect(applySurface('glass')).toBe('glass')
    expect(document.documentElement.getAttribute('data-axi-theme')).toBe('glass')
    expect(localStorage.getItem(SURFACE_STORAGE_KEY)).toBe('glass')
  })

  it('treats flat as a theme like any other', () => {
    expect(applySurface('flat')).toBe('flat')
    expect(document.documentElement.getAttribute('data-axi-theme')).toBe('flat')
  })

  it('removes the attribute for axi rather than naming the language', () => {
    applySurface('glass')
    expect(applySurface('axi')).toBe('axi')
    expect(document.documentElement.hasAttribute('data-axi-theme')).toBe(false)
    expect(localStorage.getItem(SURFACE_STORAGE_KEY)).toBe('axi')
  })

  it('crossfades, sharing one timer between accent and surface', () => {
    vi.useFakeTimers()
    applyAccent('axi-gold')
    vi.advanceTimersByTime(300)
    applySurface('glass')
    vi.advanceTimersByTime(300)
    expect(document.documentElement.classList.contains('theme-transitioning')).toBe(true)
    vi.advanceTimersByTime(250)
    expect(document.documentElement.classList.contains('theme-transitioning')).toBe(false)
    vi.useRealTimers()
  })
})

// Review Focus 3
describe('when storage is unavailable', () => {
  it('still reads defaults rather than throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled by policy')
    })
    expect(readAccent()).toBe(DEFAULT_ACCENT_ID)
    expect(readSurface()).toBe(DEFAULT_SURFACE_ID)
    vi.restoreAllMocks()
  })

  it('still applies the appearance for the life of the session', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(applyAccent('axi-gold')).toBe('axi-gold')
    expect(applySurface('glass')).toBe('glass')
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe('axi-gold')
    expect(document.documentElement.getAttribute('data-axi-theme')).toBe('glass')
    vi.restoreAllMocks()
  })
})

// Review Focus 5
describe('bootAppearance', () => {
  it('sets the accent before anything renders, so the first paint is correct', () => {
    bootAppearance()
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe(DEFAULT_ACCENT_ID)
    // Default surface is the language, which is the absence of the attribute.
    expect(document.documentElement.hasAttribute('data-axi-theme')).toBe(false)
  })

  it('restores a remembered appearance', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, 'rose-pink')
    localStorage.setItem(SURFACE_STORAGE_KEY, 'glass')
    bootAppearance()
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe('rose-pink')
    expect(document.documentElement.getAttribute('data-axi-theme')).toBe('glass')
  })

  it('does not crossfade the first paint, which would flash against an unthemed page', () => {
    bootAppearance()
    expect(document.documentElement.classList.contains('theme-transitioning')).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd ~/Documents/GitHub/axistream/packages/app
npx vitest run test/appearance.test.ts
```

Expected: FAIL — cannot resolve `../src/renderer/appearance.js`.

- [ ] **Step 4: Add the dependency**

In `packages/app/package.json`, add to `dependencies`:

```json
    "@axiapps/axi-design": "^1.43.0",
```

Then from the monorepo root, so the workspace resolves it:

```bash
cd ~/Documents/GitHub/axistream
npm install
```

- [ ] **Step 5: Create the appearance module**

Create `packages/app/src/renderer/appearance.ts`:

```ts
import accentsJson from '@axiapps/axi-design/accents.json'

export type AccentDefinition = { id: string; label: string; hex: string }

/** The palette is the design language's, read from the package rather than
 *  restated here — a copy would drift the first time an accent is added. */
export const ACCENTS: AccentDefinition[] = accentsJson as AccentDefinition[]

/**
 * AxiStream was built around #22d3ee, and `electric-cyan` exists in the palette
 * precisely so that colour survives this migration. The app therefore looks
 * essentially unchanged out of the box — but every cyan in it now follows the
 * picker instead of being welded into the stylesheet.
 */
export const DEFAULT_ACCENT_ID = 'electric-cyan'

/**
 * The surfaces the design language paints. 'axi' is the language itself, drawn
 * with no `data-axi-theme` at all. 'flat' and 'glass' are repaints of it
 * shipped as `@axiapps/axi-design/themes/<id>.css`.
 */
export type SurfaceId = 'axi' | 'flat' | 'glass'

export const SURFACES: { id: SurfaceId; label: string }[] = [
  { id: 'axi', label: 'Axi' },
  { id: 'flat', label: 'Flat' },
  { id: 'glass', label: 'Glass' }
]

/** The language itself is the default, as in every other axi app. */
export const DEFAULT_SURFACE_ID: SurfaceId = 'axi'

// Renderer-side rather than in the main process: appearance is renderer-only,
// and a synchronous read before the first render is what keeps the window from
// painting a default and visibly flipping once IPC answers.
export const ACCENT_STORAGE_KEY = 'axistream.accent'
export const SURFACE_STORAGE_KEY = 'axistream.surface'

/** Always returns an id that exists in ACCENTS. Membership is tested against
 *  the array rather than an object, so inherited property names are unknown
 *  values like any other. AxiStream has never persisted an accent before this,
 *  so there is no legacy vocabulary to translate. */
export function resolveAccentId(id?: string | null): string {
  return ACCENTS.some((a) => a.id === id) ? (id as string) : DEFAULT_ACCENT_ID
}

/** Always returns one of the three surface ids, on the same terms. */
export function resolveSurfaceId(id?: string | null): SurfaceId {
  return SURFACES.some((s) => s.id === id) ? (id as SurfaceId) : DEFAULT_SURFACE_ID
}

let transitionTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Holds the crossfade class on <html> for the length of the transition so the
 * whole window changes together instead of each element snapping on its own
 * next repaint. Shared by the accent and the surface: changing both at once
 * should still be one fade, so the timer is deliberately not per-attribute.
 */
function crossfade(root: Element): void {
  root.classList.add('theme-transitioning')
  if (transitionTimer) clearTimeout(transitionTimer)
  transitionTimer = setTimeout(() => {
    root.classList.remove('theme-transitioning')
    transitionTimer = null
  }, 500)
}

export function readAccent(): string {
  try {
    return resolveAccentId(localStorage.getItem(ACCENT_STORAGE_KEY))
  } catch {
    return DEFAULT_ACCENT_ID
  }
}

export function readSurface(): SurfaceId {
  try {
    return resolveSurfaceId(localStorage.getItem(SURFACE_STORAGE_KEY))
  } catch {
    return DEFAULT_SURFACE_ID
  }
}

/** Puts an accent on <html>, where accents.css's [data-axi-accent] rules hang,
 *  and remembers it. */
export function applyAccent(id?: string | null, opts: { transition?: boolean } = {}): string {
  const resolved = resolveAccentId(id)
  const root = document.documentElement

  if (opts.transition !== false) crossfade(root)

  root.setAttribute('data-axi-accent', resolved)
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, resolved)
  } catch {
    // Storage disabled: the accent still applies for the life of the session,
    // only the memory of it is lost.
  }
  return resolved
}

/**
 * Puts a surface on <html> and remembers it. 'axi' removes the attribute rather
 * than naming itself: the language is not a theme layered over itself, and
 * axi-design's own rule is that removing `data-axi-theme` leaves you back on it
 * with no other change.
 */
export function applySurface(id?: string | null, opts: { transition?: boolean } = {}): SurfaceId {
  const resolved = resolveSurfaceId(id)
  const root = document.documentElement

  if (opts.transition !== false) crossfade(root)

  if (resolved === 'axi') root.removeAttribute('data-axi-theme')
  else root.setAttribute('data-axi-theme', resolved)

  try {
    localStorage.setItem(SURFACE_STORAGE_KEY, resolved)
  } catch {
    // Same bargain as the accent: applied now, just not remembered.
  }
  return resolved
}

/**
 * Called at module scope in main.tsx, before createRoot. No crossfade: there is
 * nothing to fade from on the first paint, and transitioning against an
 * unthemed page is visible as a flash.
 */
export function bootAppearance(): void {
  applyAccent(readAccent(), { transition: false })
  applySurface(readSurface(), { transition: false })
}
```

If TypeScript rejects the JSON import, add `"resolveJsonModule": true` to the package's `tsconfig.json` `compilerOptions`.

- [ ] **Step 6: Run test to verify it passes**

```bash
cd ~/Documents/GitHub/axistream/packages/app
npx vitest run test/appearance.test.ts
```

Expected: PASS, 16 tests.

- [ ] **Step 7: Import the stylesheets and boot the appearance**

`packages/app/src/renderer/main.tsx` becomes:

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '@fontsource/cinzel/500.css'
import '@fontsource/cinzel/600.css'
// Order matters: axi.css declares the tokens, accents.css overrides
// --axi-accent per [data-axi-accent], the two theme files restate the whole
// token set per [data-axi-theme], and this app's own stylesheet comes last so
// its remaining local rules win without contesting specificity.
import '@axiapps/axi-design/axi.css'
import '@axiapps/axi-design/accents.css'
import '@axiapps/axi-design/themes/flat.css'
import '@axiapps/axi-design/themes/glass.css'
import { App } from './App.js'
import { bootAppearance } from './appearance.js'
import './styles.css'

// Before createRoot, so the first paint is already the right accent and surface.
bootAppearance()

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
```

Leave the `@fontsource` imports. axi-design's `--axi-sans` and `--axi-display` name font families but ship no font files; axistream supplies Inter and Cinzel, which is what those tokens want.

- [ ] **Step 8: Add the crossfade rule**

Append to `packages/app/src/renderer/styles.css`:

```css
/* Accent and surface crossfade. One class, held for 500ms by
   applyAccent/applySurface, so the whole window repaints together instead of
   each element snapping on its own next frame. */
.theme-transitioning *,
.theme-transitioning *::before,
.theme-transitioning *::after {
  transition:
    background-color 0.4s ease,
    border-color 0.4s ease,
    color 0.2s ease,
    box-shadow 0.4s ease,
    outline-color 0.4s ease !important;
}

@media (prefers-reduced-motion: reduce) {
  .theme-transitioning *,
  .theme-transitioning *::before,
  .theme-transitioning *::after {
    transition: none !important;
  }
}
```

Both halves. A surface change repaints every element on screen at once, which is exactly the motion a reader who asked for less of it does not want.

- [ ] **Step 9: Add the appearance panel to Settings**

Every other settings panel in this app is its own component rendered inside a
`<section className="setting">` (see `SettingsScreen.tsx:19-58`), so Appearance
is one too rather than being inlined.

Create `packages/app/src/renderer/components/AppearanceSettings.tsx`:

```tsx
import { useState } from 'react'
import {
  ACCENTS,
  SURFACES,
  applyAccent,
  applySurface,
  readAccent,
  readSurface
} from '../appearance.js'
import type { SurfaceId } from '../appearance.js'

export function AppearanceSettings() {
  // Seeded from storage rather than from props: appearance is renderer-only and
  // main.tsx has already applied it before this ever renders.
  const [accent, setAccent] = useState(readAccent)
  const [surface, setSurface] = useState<SurfaceId>(readSurface)

  return (
    <>
      <h3>Appearance</h3>
      <p className="muted">Shared with every other axi application.</p>

      <div className="opt">
        <div className="opt-label">Accent</div>
        <div className="quickrow">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              title={a.label}
              aria-label={a.label}
              aria-pressed={a.id === accent}
              className="axi-btn axi-btn--icon"
              // A swatch has to show the colour it selects, which is the one
              // place in this migration a value comes from data, not a token.
              style={{ background: a.hex }}
              onClick={() => setAccent(applyAccent(a.id))}
            />
          ))}
        </div>
      </div>

      <div className="opt">
        <div className="opt-label">Surface</div>
        <div className="quickrow">
          {SURFACES.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === surface}
              className={`axi-btn axi-btn--sm${s.id === surface ? ' axi-btn--primary' : ''}`}
              onClick={() => setSurface(applySurface(s.id))}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
```

State is set from `applyAccent` / `applySurface`'s **return value**, not from the
clicked id, so an unrecognised id resolves once and the component never holds an
appearance the DOM does not have.

Then in `SettingsScreen.tsx`, add the import beside the other nine:

```tsx
import { AppearanceSettings } from './AppearanceSettings.js'
```

and the section as the **first** child of `.settings-grid`, immediately after the
opening `<div className="settings-grid">` at line 18:

```tsx
          <section className="setting">
            <AppearanceSettings />
          </section>
```

First because it is the setting a reader is most likely to have come for, and
because it is the one panel that changes the look of every panel below it.

The swatch's `style={{ background: a.hex }}` is deliberate and is the single
allowance in Task 6's component guard.

- [ ] **Step 10: Verify the suite and the build**

```bash
cd ~/Documents/GitHub/axistream
npm test
npm run build
```

Expected: both PASS. The existing 40-odd tests under `packages/app/test/` must be unaffected — this task adds a stylesheet and a module and changes no component logic.

- [ ] **Step 11: Launch and confirm nothing changed yet**

```bash
cd ~/Documents/GitHub/axistream
npm run dev
```

At this point the app still uses its own CSS for everything; the tokens are merely available. Confirm:
- the app looks **the same as before this task** — if anything shifted, an axi-design base rule is reaching an element, and that is worth understanding now rather than after five more tasks
- Settings shows the new Appearance panel, and clicking a surface visibly changes *something* (the panels the language already draws), proving the theme stylesheets loaded
- the choice survives a restart

- [ ] **Step 12: Commit**

```bash
cd ~/Documents/GitHub/axistream
git add -A
git commit -m "feat: adopt axi-design and add the accent/surface pickers

First of six migration steps. The package, its accent system and all
three surfaces are now loaded and wired; the app still paints itself
from its own stylesheet, so nothing should look different yet.

electric-cyan is the default accent, which is why it was added to the
palette: the app's identity colour survives the migration.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The accent — 21 cyans and the focus ring

**Files:**
- Modify: `packages/app/src/renderer/styles.css`
- Modify: `packages/app/test/appearance.test.ts`

**Interfaces:**
- Consumes: `--axi-accent` (set by `accents.css` from `data-axi-accent`), and the appearance module from Task 1.
- Produces: no new exports. A stylesheet in which `#22d3ee` and its near neighbours no longer appear.

- [ ] **Step 1: Write the failing test**

Append to `packages/app/test/appearance.test.ts` — the `node:fs` import goes at
the **top** of the file beside the others, not in the middle where these blocks
land:

```ts
// at the top, with the other imports
import { readFileSync } from 'node:fs'
```

```ts
function styles(): string {
  return readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8')
}

describe('the accent is no longer welded into the stylesheet', () => {
  it('has no cyan literals left', () => {
    const css = styles()
    // The app's identity colour and the two shades the primary button's
    // gradient used.
    expect(css).not.toMatch(/#22d3ee/i)
    expect(css).not.toMatch(/#26d3ee/i)
    expect(css).not.toMatch(/#0bb6d6/i)
    // The rgba() form the same colour was written in for fills and borders.
    expect(css).not.toMatch(/rgba\(\s*34\s*,\s*211\s*,\s*238/)
  })

  it('uses the accent token where the cyan used to be', () => {
    expect(styles()).toMatch(/var\(--axi-accent\)/)
  })

  // Review Focus 4 — this one local rule currently overrides the language's
  // focus ring on every element in the app, including the three components
  // that style themselves inline and that no stylesheet can reach.
  it('no longer overrides the language\'s focus ring', () => {
    const css = styles()
    const focusRules = css.split('\n').filter((l) => l.includes(':focus-visible'))
    for (const rule of focusRules) {
      expect(rule).not.toMatch(/outline:\s*2px solid #/)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Documents/GitHub/axistream/packages/app
npx vitest run test/appearance.test.ts
```

Expected: FAIL — three assertions, because the cyan literals and the focus override are all still there.

- [ ] **Step 3: Replace every cyan**

In `packages/app/src/renderer/styles.css`, nine sites carry the identity colour. Each becomes the accent token or, where a fill and its border were both hand-mixed from it, a `color-mix` against the token:

| line | selector | from | to |
|---|---|---|---|
| 41 | `.brand .wordmark .accent` | `color: #22d3ee` | `color: var(--axi-accent)` |
| 42 | `.dot.accent` | `background: #22d3ee; box-shadow: 0 0 10px #22d3ee` | `background: var(--axi-accent); box-shadow: 0 0 10px var(--axi-accent)` |
| 45 | `.navitem.on` | `background: rgba(34,211,238,.1); color: #bfeef7; border-color: rgba(34,211,238,.22)` | replaced wholesale in Task 3 by `.axi-rail__item[aria-current]` — for now, `background: color-mix(in srgb, var(--axi-accent) 10%, transparent); color: var(--axi-accent); border-color: color-mix(in srgb, var(--axi-accent) 22%, transparent)` |
| 49-51 | `.updatepill` | `rgba(34,211,238,.08)` / `.3` / `color: #7ee3f2` | `color-mix` at 8% and 30% against `var(--axi-accent)`, `color: var(--axi-accent)` |
| 57 | `.qt.on` | `color: #22d3ee; border-color: rgba(34,211,238,.35)` | `color: var(--axi-accent); border-color: color-mix(in srgb, var(--axi-accent) 35%, transparent)` |
| 99 | `.setup-icon` | `background: rgba(34,211,238,.1); border-color: rgba(34,211,238,.3); color: #22d3ee` | `color-mix` at 10% and 30%, `color: var(--axi-accent)` |
| 104 | `.capture-target-list .btn.target:hover` | `border-color: rgba(34,211,238,.55); background: rgba(34,211,238,.09)` | `color-mix` at 55% and 9% |
| 108, 110 | `.badge`, `.badge.starting` | `border-color: rgba(34,211,238,.5)` / `.4`, `color: #22d3ee`, `background: rgba(34,211,238,.08)` | `color-mix` at the same percentages, `color: var(--axi-accent)` |
| 135 | `.btn.primary` | `background: linear-gradient(180deg,#26d3ee,#0bb6d6); color: #06222a; box-shadow: 0 10px 26px rgba(34,211,238,.3)` | `background: var(--axi-accent); color: var(--axi-accent-ink); box-shadow: none` |

`color-mix(in srgb, var(--axi-accent) N%, transparent)` is the honest translation of `rgba(34,211,238,.N)`: it is the accent at that alpha, whatever the accent is. It is not a colour literal, so Task 5's guard is satisfied.

**`.btn.primary` loses its gradient and glow.** This is the intentional, visible change approved in the design discussion and the single most noticeable difference a returning user will see. `--axi-accent-ink` is the ink the language draws *on* an accent fill, which is what `#06222a` was approximating by hand.

Verify the count afterwards:

```bash
cd ~/Documents/GitHub/axistream/packages/app
grep -c '22d3ee' src/renderer/styles.css   # -> 0
grep -c 'var(--axi-accent)' src/renderer/styles.css
```

- [ ] **Step 4: Delete the focus-ring override**

Line 15 of `styles.css` is:

```css
:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; border-radius: 6px; }
```

Delete the rule and its comment. axi-design already draws a focus ring on every component it styles, from `--axi-accent`, and this unscoped rule was overriding it everywhere. Deleting it is what lets the language's focus behaviour reach the app — including the three components that style themselves inline, which no stylesheet could have reached.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd ~/Documents/GitHub/axistream/packages/app
npx vitest run test/appearance.test.ts
```

Expected: PASS, 19 tests.

- [ ] **Step 6: Verify the suite and launch**

```bash
cd ~/Documents/GitHub/axistream
npm test && npm run build && npm run dev
```

Check, with the default `electric-cyan` accent: the app looks essentially as it did, **except** the Go Live button, which is now a flat accent fill with no glow. Then switch the accent through several palette entries and confirm all nine sites move together — the wordmark's second word, the brand dot and its glow, the active nav item, the quick toggles, the update pill, the setup icon, the starting badge, the capture-target hover, and the Go Live button.

Then tab through the app and confirm focus rings are visible and now drawn by the language rather than the deleted override.

- [ ] **Step 7: Commit**

```bash
cd ~/Documents/GitHub/axistream
git add -A
git commit -m "refactor(styles): the accent is a token, not a literal

All 21 occurrences of #22d3ee and its gradient shades become
var(--axi-accent), with rgba() fills translated to color-mix against the
token so they track whichever accent is live.

.btn.primary loses its gradient and coloured glow for the language's
flat accent fill — the intentional visible change agreed in design.

Also deletes the global :focus-visible override, which was overriding
the language's focus ring on every element in the app, including the
three components that style themselves inline.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The shell — and the radius, which is the risky part

**Files:**
- Modify: `packages/app/src/renderer/styles.css` (`#root`, `.app`, `.dragbar`, `.wctl`, `.wbtn`, `.sidebar`, `.navitem`, `.hero`, `.preview-backdrop`, `.preview-video`)
- Modify: `packages/app/src/renderer/App.tsx:49`, `packages/app/src/renderer/components/Sidebar.tsx`
- Create: `packages/app/test/styles-radius.test.ts`

**Interfaces:**
- Consumes: `--axi-radius`, `--axi-radius-sm`, `--axi-ground`, `--axi-ground-image`, `--axi-ink-line`, `--axi-border-panel`, `--axi-surface`, `--axi-surface-filter`, `--axi-text`, `--axi-text-dim`, `--axi-danger`; the `.axi-rail` / `.axi-rail--flush` / `.axi-rail__item` / `.axi-rail__nav` shell components.
- Produces: no new exports.

**What is deliberately NOT adopted, and why.** Read this before editing:

- **`.axi-titlebar` is not used.** `.dragbar` (line 25) is `position: absolute`, 46px, `z-index: 5`, with **no background** — an invisible drag region lying over the top of the preview, with the window buttons floating separately at `top: 9px; right: 11px`. `.axi-titlebar` is a *visible* 38px strip with a `--axi-ground-deep` fill sitting in a column flex above the content. Using it would add a bar this app deliberately does not have and push the preview down. `.dragbar`, `.wctl` and `.wbtn` stay local and take tokens.
- **`.axi-window` is not used for `.app`.** `.axi-window` is `flex-direction: column`; `.app` is a row (sidebar | screen). Overriding the direction of a shell primitive is worse than not using it. `.app` keeps its rule and takes the four properties `.axi-window` would have given it.

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/styles-radius.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8')

/**
 * The window radius is a token, so it is 16px under glass and 6px under flat.
 * Seven values across five selectors have to follow it, or the composited
 * <video> corners disagree with the frame in two of the three surfaces.
 *
 * No test here can see a composited layer. What these assertions can do is
 * prove no bare 10px radius survived, which is the failure mode that would
 * otherwise only show up on real hardware.
 */
describe('the window radius follows the surface', () => {
  const RADIUS_SELECTORS = ['#root', '.app', '.hero', '.preview-backdrop', '.preview-video']

  function ruleFor(selector: string): string {
    const line = css.split('\n').find((l) => l.trimStart().startsWith(selector + ' '))
    expect(line, `no rule found for ${selector}`).toBeDefined()
    return line!
  }

  it.each(RADIUS_SELECTORS)('%s rounds with var(--axi-radius), not a literal', (selector) => {
    const rule = ruleFor(selector)
    expect(rule).toMatch(/border(-[a-z-]+)?-radius:[^;]*var\(--axi-radius\)/)
    expect(rule).not.toMatch(/border(-[a-z-]+)?-radius:[^;]*\d+px/)
  })

  it('clips the composited video layer to the same token', () => {
    // clip-path is what actually reaches a zero-copy hardware overlay; a
    // border-radius on an ancestor does not.
    expect(ruleFor('.app')).toMatch(/clip-path:\s*inset\(0 round var\(--axi-radius\)\)/)
  })

  it('leaves no bare 10px radius anywhere in the sheet', () => {
    const offenders = css
      .split('\n')
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => /border(-[a-z-]+)?-radius:[^;]*\b10px\b/.test(l))
    expect(offenders).toEqual([])
  })
})

describe('the shell paints itself from tokens', () => {
  it('gives .app the ground colour and the ground image', () => {
    const rule = css.split('\n').find((l) => l.trimStart().startsWith('.app '))!
    expect(rule).toMatch(/background-color:\s*var\(--axi-ground\)/)
    // Glass's three radial gradients arrive through this token.
    expect(rule).toMatch(/background-image:\s*var\(--axi-ground-image\)/)
  })

  it('no longer carries a .sidebar rule, which the rail replaces', () => {
    expect(css).not.toMatch(/^\.sidebar\s*\{/m)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Documents/GitHub/axistream/packages/app
npx vitest run test/styles-radius.test.ts
```

Expected: FAIL on every assertion — all five selectors still carry `10px`.

- [ ] **Step 3: Make the radius a token — all seven values**

The spec undercounted this. `10px` appears as a radius in **seven places across five selectors**, because `#root` has its own:

| line | selector | from | to |
|---|---|---|---|
| 16 | `#root` | `border-radius: 10px` | `border-radius: var(--axi-radius)` |
| 21 | `.app` | `border-radius: 10px` | `border-radius: var(--axi-radius)` |
| 21 | `.app` | `clip-path: inset(0 round 10px)` | `clip-path: inset(0 round var(--axi-radius))` |
| 70 | `.hero` | `border-top-right-radius: 10px` | `border-top-right-radius: var(--axi-radius)` |
| 70 | `.hero` | `border-bottom-right-radius: 10px` | `border-bottom-right-radius: var(--axi-radius)` |
| 82 | `.preview-backdrop` | `border-radius: 0 10px 10px 0` | `border-radius: 0 var(--axi-radius) var(--axi-radius) 0` |
| 84 | `.preview-video` | `border-radius: 0 10px 10px 0` | `border-radius: 0 var(--axi-radius) var(--axi-radius) 0` |

**Why `.preview-video` and `.preview-backdrop` must self-round, and must not simply be left alone:** the comment at lines 19-20 already records it — `clip-path` clips composited descendants where `overflow: hidden` plus `border-radius` does not. The two `<video>` elements round themselves to force Chromium off the zero-copy hardware overlay path, which ignores an ancestor's clip entirely. Once the frame radius is 16px under glass and 6px under flat, a video still rounded to 10px is visibly wrong at both.

Update the comment at lines 11-13 and 67-69 to say `var(--axi-radius)` rather than "the radius" / "10px" wherever they name the number.

- [ ] **Step 4: Paint `.app` and the floating chrome from tokens**

`.app` (line 21) becomes:

```css
.app { position: relative; height: 100%; display: flex; background-color: var(--axi-ground); background-image: var(--axi-ground-image); border-radius: var(--axi-radius); overflow: hidden; border: var(--axi-border-panel) solid var(--axi-ink-line); clip-path: inset(0 round var(--axi-radius)); }
```

`.wbtn` (lines 29-31) keeps its translucent black fill — that is a legibility device over moving video, not a surface — and takes tokens for its inks, corner and destructive state:

```css
.wbtn { width: 28px; height: 24px; border-radius: var(--axi-radius-sm); display: grid; place-items: center; color: var(--axi-text-dim); background: rgba(0,0,0,.32); border: var(--axi-border-control) solid rgba(255,255,255,.08); font-size: 12px; cursor: pointer; }
.wbtn:hover { color: var(--axi-text); background: rgba(255,255,255,.1); }
.wbtn.close:hover { color: var(--axi-ink-on-fill); background: var(--axi-danger); border-color: transparent; }
```

`.dragbar` (line 25) has no colour and needs no change. `.wctl` (line 28) has no colour and needs no change.

- [ ] **Step 5: Replace the sidebar with the rail**

`.axi-rail--flush` is an exact match for `.sidebar`'s shape: `border: 0` plus a logical `border-inline-end` in `--axi-ink-line`, and `border-radius: 0`. The rail paints itself with `--axi-surface` and `backdrop-filter: var(--axi-surface-filter)`, so glass works with no further work.

In `packages/app/src/renderer/components/Sidebar.tsx`, the root element's class becomes:

```tsx
className="axi-rail axi-rail--flush"
```

and `.navitem` / `.navitem.on` / `.navitem.dim` become:

```tsx
// nav container
className="axi-rail__nav"
// each item
className="axi-rail__item"
// the active item — aria-current is the language's selector, and it is also
// the correct accessibility semantic, which `.on` never was
aria-current={active === id ? 'page' : undefined}
```

For the dimmed "coming soon" items, wrap that group in `axi-rail__nav axi-rail__nav--quiet`, which is the language's own quieter treatment, rather than keeping a `.dim` colour override.

**Keep the drag-region declarations.** They are Electron behaviour, not appearance, and `.axi-rail` has no opinion about them. Add a local rule:

```css
/* The rail is a window-drag handle (frameless window); interactive children
   must opt out or Electron eats their clicks. This is behaviour, not paint, so
   it stays local rather than being pushed upstream. */
.axi-rail { -webkit-app-region: drag; }
.axi-rail button { -webkit-app-region: no-drag; }
```

Then set the width knob and delete the old rules:

```css
/* The language's rail defaults to 208px; this app's sidebar has always been 200. */
.axi-rail { --axi-rail-w: 200px; }
```

Delete `.sidebar`, `.sidebar button`, `.navitem`, `.navitem.on` and `.navitem.dim` from `styles.css`.

- [ ] **Step 6: Make the hero backsplash follow the surface**

`.hero`'s `linear-gradient(135deg,#13243a 0%,#1c1c40 45%,#311a35 80%,#3a1f2a 100%)` is what the app shows when there is no capture. It is decoration, not legibility, so it follows the surface:

```css
.hero { flex: 1; position: relative; overflow: hidden; background-color: var(--axi-ground-deep); background-image: var(--axi-ground-image); background-size: cover; background-position: center; display: flex; flex-direction: column; border-top-right-radius: var(--axi-radius); border-bottom-right-radius: var(--axi-radius); }
```

`.hero.setup::before`'s two radial gradients (line 73) stay as they are: they are the setup screen's own depth, drawn in translucent blue and violet over whatever the ground is, and they read correctly on all three surfaces. They are `rgba()`, so the guard passes.

**Leave the black scrims alone.** `.hero-top` (line 106), `.hero-bottom` (121), `.hero::after` (89) and `.overlay-pill` (117) draw directional `rgba(0,0,0,…)` gradients so white text stays readable over arbitrary moving pixels. They are not surfaces and do not become `--axi-surface-*`.

- [ ] **Step 7: Run test to verify it passes**

```bash
cd ~/Documents/GitHub/axistream/packages/app
npx vitest run test/styles-radius.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 8: Verify the suite and the build**

```bash
cd ~/Documents/GitHub/axistream
npm test
npm run build
```

Expected: both PASS. Any test that asserted on `.navitem` or `.sidebar` class names needs updating to the rail's classes — that is a real change to the markup contract, so update the test rather than keeping the old class as an alias.

- [ ] **Step 9: THE HIGH-RISK CHECK — video corners on real hardware**

This is the one item in the whole migration that no test can reach, and the one most likely to ship broken.

```bash
cd ~/Documents/GitHub/axistream
npm run dev
```

**Start a real capture** so the preview `<video>` is actually compositing frames — a static setup screen does not exercise the hardware overlay path at all. Then, for **each** of Axi, Flat and Glass:

- look at the window's **top-right and bottom-right corners**, where the video meets the frame
- confirm the video's corner radius matches the window's, with no square corner poking out past the rounded frame and no gap between them
- confirm the same for `.preview-backdrop`, the blurred letterbox layer behind it, by playing a source whose aspect ratio does not fill the hero

If a corner is square under any surface, the composited layer is ignoring the clip: the fix is that the `<video>` element itself must carry a non-`none` `border-radius`, not that the ancestor's `clip-path` needs adjusting. Do not ship this task until all three surfaces are clean.

Also check, while you are there, that the rail reads correctly on glass — a translucent panel is where a nav item that hard-coded its own background would betray itself.

- [ ] **Step 10: Commit**

```bash
cd ~/Documents/GitHub/axistream
git add -A
git commit -m "refactor(shell): the frame is the language's, and the radius is a token

The sidebar becomes .axi-rail--flush, which matches its shape exactly
(border-inline-end, no radius) and paints itself from --axi-surface, so
glass works for free. .navitem becomes .axi-rail__item with aria-current,
which is both the language's selector and the correct semantic.

.axi-titlebar is deliberately NOT adopted: .dragbar is an invisible
absolute drag overlay, not a titlebar, and a visible 38px strip would
push the preview down. .axi-window is likewise not adopted for .app,
which is a row where .axi-window is a column.

The frame radius becomes var(--axi-radius) in all seven places it
appeared across five selectors — #root had its own, which the spec
undercounted. That includes .app's clip-path and both preview layers'
self-rounding, which exists to force Chromium off the zero-copy hardware
overlay; left at 10px they would disagree with the frame under glass
(16px) and flat (6px).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Component swaps

**Files:** 20 files under `packages/app/src/renderer/components/`, and the corresponding rules in `packages/app/src/renderer/styles.css`.

**Interfaces:**
- Consumes: the language's component classes. No new exports.
- Produces: markup that asks for the language's components by name, so a change to the language reaches this app.

**Order matters:** primitives before the panels that contain them, so a panel is never restyled around a child that is about to change.

The mapping is the specification — each row is "replace these local classes with these, and delete the local rules they leave behind":

| # | component | local classes | language |
|---|---|---|---|
| 1 | `Select.tsx` | `.sel-trigger`, `.sel-list`, `.dropup`, `.dropup-item` | `.axi-select`, `.axi-menu` |
| 2 | `ActionButton.tsx`, `RecordButton.tsx` | `.btn`, `.btn.lg`, `.btn.ghost`, `.btn.danger`, `.action-split` | `.axi-btn`, `.axi-btn--primary`, `.axi-btn--ghost`, `.axi-btn--sm`, `.axi-btn--xs` |
| 3 | `StatChips.tsx` | `.chip`, `.chip.good`, `.chip.warn`, `.chip.bad`, `.chips` | `.axi-chip--meta`, `.axi-chip--ok`, `.axi-chip--warn`, `.axi-chip--danger`, `.axi-row` |
| 4 | `LiveBadge.tsx` | `.badge`, `.badge.live`, `.badge.starting` | `.axi-pill`, `.axi-chip--danger`, `.axi-chip--warn` |
| 5 | `AudioPulse.tsx` | `.audio-pulse`, `.audio-row`, `.hear-pill` | `.axi-meter`, `.axi-meter-list`, `.axi-bars` |
| 6 | `ToastHost.tsx` | `.toasts`, `.toast`, `.toast-body`, `.toast-msg`, `.toast-detail`, `.toast-x` | `.axi-toasts`, `.axi-toast`, `.axi-toast--ok`, `.axi-toast--warn`, `.axi-toast--danger` |
| 7 | `KeyPicker.tsx` | `.keypicker*` (15 selectors), `.modal`, `.modal-backdrop` | `.axi-modal`, `.axi-scrim`, `.axi-kbd`, `.axi-chip`, `.axi-menu` |
| 8 | `TitlePromptModal.tsx` | `.modal`, `.modal-backdrop`, `.modal-actions` | `.axi-modal`, `.axi-scrim` |
| 9 | `WelcomeWizard.tsx` | `.wizard-body`, `.wizard-head`, `.wizard-dots`, `.wizard-ok` | `.axi-sheet`, `.axi-pages` |
| 10 | `WelcomeBanner.tsx` | `.welcome-banner`, `.welcome-x` | `.axi-notice` |
| 11 | `StreamSummaryPanel.tsx` | `.summary-panel`, `.summary-stats`, `.summary-stat`, `.summary-label`, `.summary-value`, `.summary-path`, `.summary-actions` | `.axi-panel`, `.axi-grid`, `.axi-stat` |
| 12 | `SettingsScreen.tsx` **and `AppearanceSettings.tsx`** | `.settings-grid`, `.settings-inner`, `.settings-panel`, `.setting`, `.opt`, `.opt-label`, `.muted` | `.axi-page`, `.axi-panel`, `.axi-row`, `.axi-stack`, `.axi-ink-dim` |
| 13 | `QualitySettings.tsx` | `.quality-body`, `.quality-chips`, `.q-chip`, `.q-sub`, `.q-note`, `.q-fallback`, `.qt`, `.qt.on` | `.axi-chip--action`, `.axi-tabs`, `.axi-well` |
| 14 | `AudioSettings.tsx`, `GameAudioSettings.tsx` | `.hear-*` (9 selectors), `.ptt*`, `.audio-test` | `.axi-meter-list`, `.axi-search`, `.axi-row`, `.axi-switch` |
| 15 | `HotkeySettings.tsx` | `.hotkey-row`, `.hotkey-rows`, `.hotkey-label` | `.axi-row`, `.axi-kbd` |
| 16 | `RecordingSettings.tsx` | `.rec-dot`, `.rec-elapsed` | `.axi-diamond--danger`, `.axi-stat` |
| 17 | `YouTubeSettings.tsx` | `.yt-*` (11 selectors) | `.axi-input`, `.axi-notice`, `.axi-row`, `.axi-switch`, `.axi-code` |
| 18 | `UpdatesSettings.tsx` | `.updates-row`, `.whatsnew`, `.whatsnew-body` | `.axi-row`, `.axi-prose` |
| 19 | `DiagnosticsSettings.tsx`, `AboutSettings.tsx` | `.about-links`, `.about-obs`, `.why` | `.axi-row`, `.axi-link`, `.axi-prose` |
| 20 | `ErrorBoundary.tsx` | `.crash`, `.crash-actions`, `.crash-live`, `.crash-msg` | `.axi-notice--danger`, `.axi-panel` |

**Staying local, painted in tokens by Task 5:** `MaskEditor` (`.mask-*`, 12 selectors), `PreviewVideo` / `.preview-backdrop`, the `.hero*` family, `AxiMark`, `.enginepill`, `.overlay*`, `.spin`, `.field-err`, `.webcam-*`. Each is media chrome or an app-specific editor with no counterpart in the language.

- [ ] **Step 1: Swap one component and prove the pattern**

Start with `Select.tsx` — it is the smallest, it is used by several later components, and it is one of the three that also carries inline styles, so it exposes early whether Task 6 needs to come sooner.

Replace its classes per row 1, delete `.sel-trigger`, `.sel-list`, `.dropup` and `.dropup-item` from `styles.css`, then:

```bash
cd ~/Documents/GitHub/axistream/packages/app
npx vitest run
```

Expected: PASS. If a test asserted on `.sel-trigger`, update it to the language's class — the markup contract genuinely changed.

- [ ] **Step 2: Launch and look at it under all three surfaces**

```bash
cd ~/Documents/GitHub/axistream
npm run dev
```

Open a settings panel with a dropdown. Check it on Axi, Flat and Glass. `docs/RULES.md` is explicit that a component that hard-coded something looks fine until you change the thing it hard-coded, and that a panel reading correctly on opaque slate can vanish on a translucent one. **This check is per-component, not once at the end.**

- [ ] **Step 3: Commit the first swap on its own**

```bash
cd ~/Documents/GitHub/axistream
git add -A
git commit -m "refactor(select): ask the language for a select

First of 20 component swaps. Kept separate so the pattern — swap classes,
delete the local rules, check all three surfaces — is reviewable before
it is repeated 19 times.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Work rows 2-20 in order**

For each row: swap the classes, delete the local rules it leaves behind in `styles.css`, run `npx vitest run`, and look at the component under all three surfaces before moving on.

Commit in groups that make sense to review together rather than one commit per row — the primitives (rows 2-6) as one, the modals (7-10) as one, the settings panels (11-20) in two or three. Each commit must leave the suite green and the app launchable.

- [ ] **Step 5: Confirm the swap is complete**

```bash
cd ~/Documents/GitHub/axistream/packages/app
# Every class the mapping table retires should be gone from both the markup
# and the stylesheet.
for c in sel-trigger sel-list dropup toast toasts keypicker wizard-body \
         welcome-banner summary-panel settings-panel q-chip hotkey-row \
         updates-row crash badge chip; do
  n=$(grep -ro "\\.$c\\b" src/renderer/styles.css | wc -l)
  m=$(grep -ro "\"$c\|'$c\| $c " src/renderer/components/*.tsx | wc -l)
  printf '%-16s css=%s tsx=%s\n' "$c" "$n" "$m"
done
```

Every line should read `css=0`. A non-zero `tsx` count is fine only where the class is one this plan said stays local.

- [ ] **Step 6: Full verification**

```bash
cd ~/Documents/GitHub/axistream
npm test
npm run build
```

Expected: both PASS.

---

### Task 5: The literal sweep, and the guard that proves it finished

**Files:**
- Modify: `packages/app/src/renderer/styles.css`
- Create: `packages/app/test/styles-tokens.test.ts`

**Interfaces:** no exports. This task's deliverable is the guard test plus a stylesheet that satisfies it.

- [ ] **Step 1: Write the failing guard**

Create `packages/app/test/styles-tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const PATH = new URL('../src/renderer/styles.css', import.meta.url)

/**
 * The migration's end state: every colour in this stylesheet comes from a
 * token. This guard is the only way to know the sweep actually finished rather
 * than nearly finished, and it keeps the file from regressing afterwards.
 *
 * It matches HEX LITERALS ONLY — #rgb, #rrggbb, #rrggbbaa. That is deliberate,
 * not an oversight. The black-over-video legibility scrims in the .hero-*,
 * .preview-*, .overlay*, .wbtn, .badge, .pill and .chip rules are
 * rgba(0,0,0,…) and rgba(255,255,255,…) functions, and they pass by
 * construction. They are legibility devices over arbitrary moving pixels, not
 * surfaces, and --axi-surface-* would be the wrong answer for them. See the
 * spec's "Black over video" section.
 */
describe('styles.css has no colour literals', () => {
  it('contains no hex colour anywhere', () => {
    const css = readFileSync(PATH, 'utf8')
    const offenders = css
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /#[0-9a-fA-F]{3,8}\b/.test(line))
      .map(([n, line]) => `${n}: ${line.trim()}`)
    expect(offenders).toEqual([])
  })

  it('reaches for tokens instead', () => {
    const css = readFileSync(PATH, 'utf8')
    // A sheet that passed the first assertion by having no colours at all
    // would not be a migration.
    expect(css.match(/var\(--axi-/g)!.length).toBeGreaterThan(50)
  })

  it('keeps the black-over-video scrims, which are legibility and not paint', () => {
    const css = readFileSync(PATH, 'utf8')
    expect(css).toMatch(/rgba\(0,\s*0,\s*0,/)
  })
})
```

- [ ] **Step 2: Run it and read the list**

```bash
cd ~/Documents/GitHub/axistream/packages/app
npx vitest run test/styles-tokens.test.ts
```

Expected: FAIL, printing every remaining line and its number. That list is this task's worklist.

- [ ] **Step 3: Sweep the list**

Each remaining literal maps to one of these. Where a value is between two tokens, take the nearer one rather than inventing a `color-mix` to hit the old value exactly — the point is to join the language, not to preserve every hand-tuned shade.

| old literals | token |
|---|---|
| `#0b0d12`, `#090b10` | `--axi-ground` |
| `#0a0c11`, `#0d1117` | `--axi-ground-deep` |
| `#131a23`, `#1a222c` | `--axi-surface` |
| `#242a3b` | `--axi-surface-raised` |
| `#141822` | `--axi-well-fill` |
| `#1d2530`, `#161c25`, `#2a323b` | `--axi-ink-line` |
| `#e6edf3`, `#dfe7ef`, `#fff`, `#ffffff` | `--axi-text` |
| `#c7d0d9`, `#cdd6e0`, `#b9c4cf`, `#8b949e` | `--axi-text-dim` |
| `#5b6470`, `#55606c`, `#586069` | `--axi-text-faint` |
| `#3fb950`, `#5fe39a`, `#7be3a0` | `--axi-ok` |
| `#fbbf24`, `#ffd479` | `--axi-warn` |
| `#e23a52`, `#f0556b`, `#f87171`, `#fb7185`, `#ff8b9c`, `#ffb3bf`, `#fecdd3` | `--axi-danger` |
| `#9fd8ff` | `--axi-accent` (the link ink) |
| `#06222a` | `--axi-accent-ink` |

For the `.hero.setup` text shadows (`0 1px 3px rgba(0,0,0,.5)`) and `.hero-title`'s `text-shadow: 0 1px 4px #000` — the latter **is** a hex literal and must go. It is a legibility shadow over video, so it becomes `rgba(0,0,0,.9)`, which the guard accepts and which says the same thing.

- [ ] **Step 4: Run the guard until it passes**

```bash
cd ~/Documents/GitHub/axistream/packages/app
npx vitest run test/styles-tokens.test.ts
```

Expected: PASS, 3 tests. Re-run after each batch; the failure output is the remaining worklist.

- [ ] **Step 5: Full verification and the three-surface pass**

```bash
cd ~/Documents/GitHub/axistream
npm test
npm run build
npm run dev
```

With every colour now a token, this is the first point where switching surface should change *everything*. Walk all three surfaces through:
- the setup/idle state and the live capture
- every settings panel
- a toast of each kind (ok / warn / error)
- the stream summary panel
- the welcome wizard

Anything that stays on Axi's colours while the rest of the window moves is a literal the sweep missed in an inline style — note it for Task 6.

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/GitHub/axistream
git add -A
git commit -m "refactor(styles): every colour is a token

styles.css now contains zero hex literals, enforced by a guard test that
will keep it that way. The only colours left are the black-over-video
legibility scrims in the hero and preview rules, which are rgba()
functions over arbitrary moving pixels rather than surfaces — the one
sanctioned exception, and narrow enough that the guard passes by
construction rather than by exemption.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The three inline-style components

**Files:**
- Modify: `packages/app/src/renderer/components/MaskEditor.tsx`, `Select.tsx`, `WebcamSettings.tsx`

**Interfaces:** no exports.

These come last because a stylesheet cannot reach an inline `style={{}}`, so Task 5's guard says nothing about them — and because the classes around them had to settle first.

- [ ] **Step 1: Find every inline colour**

```bash
cd ~/Documents/GitHub/axistream/packages/app
grep -n "style={{" src/renderer/components/MaskEditor.tsx src/renderer/components/Select.tsx src/renderer/components/WebcamSettings.tsx
grep -nE "#[0-9a-fA-F]{3,8}" src/renderer/components/*.tsx
```

The second command is the actual worklist: every hex literal in every component, not just the three. The swatch `background: a.hex` added in Task 1's Step 9 is the one legitimate hit — a swatch must show the colour it selects — and is left alone.

- [ ] **Step 2: Write the failing test**

Create `packages/app/test/components-tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'

const DIR = new URL('../src/renderer/components/', import.meta.url)

/**
 * A stylesheet cannot reach an inline style, so Task 5's guard says nothing
 * about these. This is the same rule applied where the other one cannot see.
 *
 * The one allowed hit is the accent swatch in the appearance panel: a swatch
 * has to show the colour it selects, and that value comes from the palette
 * data rather than from a hand-picked literal.
 */
describe('components carry no colour literals', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.tsx'))

  it.each(files)('%s uses tokens, not hex', (file) => {
    const src = readFileSync(new URL(file, DIR), 'utf8')
    const offenders = src
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /#[0-9a-fA-F]{3,8}\b/.test(line))
      // The swatch shows the accent it selects; the colour is palette data.
      .filter(([, line]) => !line.includes('a.hex'))
      .map(([n, line]) => `${n}: ${line.trim()}`)
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 3: Run it and read the list**

```bash
cd ~/Documents/GitHub/axistream/packages/app
npx vitest run test/components-tokens.test.ts
```

Expected: FAIL for each offending file, printing the lines.

- [ ] **Step 4: Convert them**

An inline style reads a token the same way a stylesheet does:

```tsx
style={{ background: 'var(--axi-surface)', color: 'var(--axi-text)' }}
```

Use the same mapping table as Task 5 Step 3.

**`MaskEditor` is the one to be careful with.** Its `.mask-rect` handles are drawn over live video, so some of its colours are legibility devices rather than surfaces — the same exception the hero scrims get. A handle that must stay visible over any frame keeps an `rgba()` with a hard edge; a handle that is chrome takes `--axi-accent` (it is a selection affordance, which is what an accent is for). Where a value is genuinely a measurement rather than a colour, leave it.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd ~/Documents/GitHub/axistream/packages/app
npx vitest run test/components-tokens.test.ts
```

Expected: PASS.

- [ ] **Step 6: Final verification**

```bash
cd ~/Documents/GitHub/axistream
npm test
npm run build
```

Expected: both PASS, including all four guard tests added by this plan.

- [ ] **Step 7: The acceptance pass**

```bash
cd ~/Documents/GitHub/axistream
npm run dev
```

With a **live capture running**, walk all three surfaces through every screen:

- [ ] idle / setup state
- [ ] live capture, including the preview and the blurred backdrop
- [ ] the stream summary panel
- [ ] every one of the ten settings panels
- [ ] the mask editor, over live video — the handles must be visible on all three
- [ ] the webcam settings
- [ ] the welcome wizard and the title prompt
- [ ] a toast of each kind
- [ ] **the video corners**, top-right and bottom-right, under each surface
- [ ] keyboard focus on every interactive control, now that the local override is gone
- [ ] several accents, confirming everything that was cyan moves together

- [ ] **Step 8: Commit**

```bash
cd ~/Documents/GitHub/axistream
git add -A
git commit -m "refactor(components): tokens reach the inline styles too

MaskEditor, Select and WebcamSettings styled themselves inline, where no
stylesheet and no guard could reach them. A second guard now covers every
component file, with one allowance: the accent swatch shows the colour it
selects, which is palette data rather than a literal.

Completes the migration. Every colour in the app is a token, the accent
is a setting, and all three surfaces are reachable from Settings.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verification checklist

```bash
cd ~/Documents/GitHub/axistream

# 1. On the published version that has electric-cyan.
node -e "console.log(require('./packages/app/package.json').dependencies['@axiapps/axi-design'])"
npm view @axiapps/axi-design version

# 2. All four stylesheets imported, app's own last.
grep -n "axi-design\|styles.css" packages/app/src/renderer/main.tsx

# 3. Zero hex literals in the stylesheet, and plenty of tokens.
grep -cE '#[0-9a-fA-F]{3,8}\b' packages/app/src/renderer/styles.css   # -> 0
grep -co 'var(--axi-' packages/app/src/renderer/styles.css            # -> > 50

# 4. No bare radius literal survives.
grep -nE 'border(-[a-z-]+)?-radius:[^;]*[0-9]+px' packages/app/src/renderer/styles.css
# -> no output

# 5. The language's titlebar and window were not adopted.
grep -n 'axi-titlebar\|axi-window' packages/app/src/renderer/ -r    # -> no output

# 6. 'axi' is never named as a theme.
grep -rn 'data-axi-theme., *.axi.' packages/app/src                  # -> no output

# 7. The suite, including all four guards.
npm test
npm run build
```

Then the thing no command can check, and the reason this plan puts it in three separate tasks rather than once at the end: **run the app with a live capture and look at all three surfaces.** A green suite proves the attributes are set and the literals are gone. It cannot see a composited video layer with the wrong corner radius, and it cannot tell you whether flat reads right.
