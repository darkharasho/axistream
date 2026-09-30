# axistream joins the design language

**Status:** approved in chat 2026-09-30, pending written review

## Goal

axistream adopts `@axiapps/axi-design` completely: the language's stylesheet,
the accent system, all three surfaces (Axi / Flat / Glass), and its components
wherever the language has a counterpart. `packages/app/src/renderer/styles.css`
ends this round with **zero colour literals** — every colour comes from a token.

The app's cyan stops being baked in and becomes an accent the reader can change.
Because `electric-cyan` `#22d3ee` is axistream's default accent, the app looks
essentially unchanged on first launch while every cyan in it now follows the
picker.

## The gap it closes

axistream is the only desktop app in the suite that does not depend on
axi-design at all — `packages/app/package.json` lists `archiver` and `koffi` and
nothing else. Its entire appearance lives in one 543-line stylesheet holding
**214 hex literals** across roughly 140 selectors, with `#22d3ee` appearing 21
times.

That means it does not merely look different from its siblings; it cannot be
corrected. There is no token to change, no accent to pick, no surface to switch.
Every visual decision is a literal in one file.

## Prerequisite

axi-design **1.43.0**, which adds the `electric-cyan` accent. Specced in that
repo at `docs/superpowers/specs/2026-09-30-surface-picker-rollout-design.md`.
Nothing here can start before that version is published.

## What this is not

- **Not a redesign.** axistream is a media-first app: a preview surface with
  chrome floating over it. That stays. The goal is that it look like it belongs
  to the language, not that it stop being a streaming app.
- **Not a rewrite of the app's behaviour.** One exception, called out under
  "the radius" below, because the rounded-video workaround is behaviour wearing
  a stylesheet's clothes.
- **Not a change to axi-design.** If this migration wants something the
  language does not have, the answer in this round is a local rule painted in
  tokens, not a new upstream component. `docs/RULES.md` requires a new
  capability to cost a main-theme token first, and that is a separate
  conversation with its own review.

## Part one — adoption

`packages/app/package.json` gains `@axiapps/axi-design: ^1.43.0`.

`src/renderer/main.tsx` imports, in this order:

```ts
import '@axiapps/axi-design/axi.css'
import '@axiapps/axi-design/accents.css'
import '@axiapps/axi-design/themes/flat.css'
import '@axiapps/axi-design/themes/glass.css'
import './styles.css'
```

The app's own stylesheet loads last, so its remaining local rules win over the
language without contesting specificity.

A new `src/renderer/appearance.ts` carries the accent and surface pair, ported
from the finished five-app pattern rather than invented here:

```ts
export const DEFAULT_ACCENT_ID = 'electric-cyan'
export const DEFAULT_SURFACE_ID: SurfaceId = 'axi'
```

Both attributes go on `document.documentElement`, both persist to
`localStorage`, `applySurface('axi')` removes `data-axi-theme` rather than
setting it, and `resolveSurfaceId` / `resolveAccentId` are total functions that
return the default for any unrecognised stored string. axistream has never had
either setting, so there is no legacy key to migrate.

The picker goes in `SettingsScreen.tsx` as a new appearance section: accent
swatches and three `axi-btn axi-btn--sm` surface buttons, the current one also
`axi-btn--primary` with `aria-pressed`.

The crossfade rule (`theme-transitioning`, 0.4s on background / border / shadow
/ outline colour, 0.2s on text, disabled under `prefers-reduced-motion`) is new
here and lands in `styles.css`.

## Part two — the shell

The app shell is `App.tsx:49`: `.app` is a **row** flex holding an invisible
`.dragbar` overlay, the sidebar, and `.hero`. Reading it changed two of the
mappings this spec was originally drafted around.

### The sidebar is an exact match

`.sidebar` (200px, `border-right`, no radius, `-webkit-app-region: drag` with
`.sidebar button { no-drag }`) becomes `axi-rail axi-rail--flush`.
`.axi-rail--flush` is precisely this shape: `border: 0` plus a logical
`border-inline-end` in `--axi-ink-line`, `border-radius: 0`. Width comes from
the `--axi-rail-w` knob set to `200px`; padding from `--axi-rail-pad`. The rail
paints itself with `--axi-surface` and `backdrop-filter:
var(--axi-surface-filter)`, so glass works with no further work.

`.navitem` / `.navitem.on` / `.navitem.dim` become `.axi-rail__item`,
`[aria-current]` and `.axi-rail__nav--quiet`. The `on` state's hand-built
`rgba(34,211,238,.1)` fill with a `.22` border is exactly what
`.axi-rail__item[aria-current]` already draws from `--axi-accent`.

The drag-region declarations stay local. They are Electron behaviour, not
appearance, and `.axi-rail` has no opinion about them.

### There is no titlebar, so `.axi-titlebar` is not adopted

`.dragbar` is **not** a titlebar. It is `position: absolute`, 46px tall,
`z-index: 5`, with no background — an invisible drag region lying over the top
of the preview. `.wctl` floats the window buttons at `top: 9px; right: 11px`,
`z-index: 10`, over the video.

`.axi-titlebar` is the opposite: a *visible* 38px strip with a
`--axi-ground-deep` background sitting in a column flex above the content. Using
it would add a bar this app deliberately does not have and push the preview
down. So `.dragbar`, `.wctl` and `.wbtn` **stay local**, repainted in tokens:
`--axi-text-dim` and `--axi-text` for the button inks, `--axi-radius-sm` for
their corners, `--axi-danger` for close-on-hover. Their translucent
`rgba(0,0,0,.32)` fill is a legibility device over moving video, not a surface —
see "black over video" below.

The 46px-versus-38px question raised in the design discussion therefore does not
arise. Nothing is being reconciled, because axistream has no titlebar to
reconcile.

### `.app` keeps its rule

`.axi-window` is `flex-direction: column`; axistream's `.app` is a row.
Overriding the direction of a shell primitive is worse than not using it, so
`.app` keeps its own rule and takes the four things `.axi-window` would have
given it: `background-color: var(--axi-ground)`,
`background-image: var(--axi-ground-image)`,
`border: var(--axi-border-panel) solid var(--axi-ink-line)`, and
`border-radius: var(--axi-radius)`. Glass's three radial gradients arrive
through `--axi-ground-image` for free.

### The radius, which is the one behavioural change

`.app` currently pairs `border-radius: 10px` with
`clip-path: inset(0 round 10px)`, and `.preview-video` / `.preview-backdrop`
each self-round with `border-radius: 0 10px 10px 0`. That self-rounding is not
decoration: it forces Chromium off the zero-copy hardware overlay path, which
ignores an ancestor's clip and would otherwise draw square video corners over
the rounded frame.

Once the frame radius is `var(--axi-radius)`, it is 16px under glass and 6px
under flat. So all four of those values become `var(--axi-radius)` — including
the `clip-path` (`inset(0 round var(--axi-radius))`) and the two video rules
(`0 var(--axi-radius) var(--axi-radius) 0`). If they are left at 10px the video
corners disagree with the frame in two of three surfaces.

**This is the highest-risk item in the migration.** It is the only change that
touches compositing rather than colour, it cannot be verified by any test in
this repo, and it must be checked by eye on real hardware in all three surfaces
with a live capture running.

### Black over video

`.hero-top`, `.hero-bottom` and `.hero::after` draw directional
`rgba(0,0,0,…)` gradients so white text stays readable over arbitrary moving
pixels. These are **not** surfaces and do not become `--axi-surface-*`. Where a
flat scrim is wanted, `--axi-scrim` applies; where legibility needs a
directional gradient, the local `rgba(0,0,0,…)` stays.

This is the one sanctioned exception to "zero colour literals", and it is
narrow: black-and-transparent only, only over media, and only in the `.hero-*`
and `.preview-*` rules. The hex-literal guard below still passes, because these
are `rgba()` functions and not hex literals; the exception is recorded here so
that it reads as a decision rather than as a miss.

`.hero`'s own `linear-gradient(135deg,#13243a,#1c1c40,#311a35,#3a1f2a)`
backsplash is different — it is what the app shows when there is no capture, so
it is decoration and not legibility. It becomes a `--axi-ground` /
`--axi-ground-image` composition and follows the surface.

## Part three — the accent

`#22d3ee` appears 21 times. Every occurrence becomes `var(--axi-accent)` or
disappears into a component that already uses it:

| where | becomes |
|---|---|
| `.brand .wordmark .accent` | `var(--axi-accent)` |
| `.dot.accent` + its `0 0 10px` glow | `.axi-diamond--accent` |
| `.navitem.on` | `.axi-rail__item[aria-current]` |
| `.qt.on` | `.axi-chip--action` / `.axi-tabs` |
| `.updatepill` | `.axi-pill--sm` |
| `.setup-icon` | `var(--axi-accent)` |
| `.badge.starting` | `.axi-chip--warn` |
| `.btn.primary` | `.axi-btn--primary` |
| `:focus-visible { outline: 2px solid #22d3ee }` | removed — the language already draws focus |

**`.btn.primary` loses its gradient and glow.** It is currently
`linear-gradient(180deg,#26d3ee,#0bb6d6)` with a coloured drop shadow;
`.axi-btn--primary` is a flat accent fill. This is an intentional, visible
change, approved in the design discussion, and it is the single most noticeable
difference a returning user will see.

Removing the global `:focus-visible` override matters more than its one line
suggests: the local rule currently overrides the language's focus ring
everywhere, which would otherwise make every migrated component focus wrongly.

## Part four — the remaining literals

The other ~193 literals resolve to `--axi-ground`, `--axi-ground-deep`,
`--axi-surface` / `-raised` / `-float`, `--axi-well-fill`, `--axi-text` /
`-dim` / `-faint`, `--axi-ink-line`, `--axi-rule`, and
`--axi-ok` / `--axi-warn` / `--axi-danger`.

Components with a counterpart swap classes rather than getting tokens:

| component | language |
|---|---|
| `Select` | `.axi-select` |
| `ActionButton`, `RecordButton` | `.axi-btn` and variants |
| `ToastHost` | `.axi-toasts` / `.axi-toast` + status variants |
| `StatChips` | `.axi-chip--meta` / `.axi-stat` |
| `LiveBadge` | `.axi-pill` / `.axi-chip--ok` |
| `KeyPicker` | `.axi-modal` + `.axi-kbd` |
| `WelcomeWizard`, `TitlePromptModal` | `.axi-modal` / `.axi-sheet` |
| `StreamSummaryPanel` | `.axi-stat` grid in a `.axi-panel` |
| `AudioPulse` | `.axi-meter` / `.axi-bars` |
| `SettingsScreen` and the ten settings panels (`About`, `Audio`, `Diagnostics`, `GameAudio`, `Hotkey`, `Quality`, `Recording`, `Updates`, `Webcam`, `YouTube`) | `.axi-panel`, `.axi-row`, `.axi-switch`, `.axi-input` |
| `WelcomeBanner`, `.updatepill` | `.axi-notice` / `.axi-pill` |

Staying local, painted in tokens: `MaskEditor`, `PreviewVideo` /
`.preview-backdrop`, the `.hero*` family, `AxiMark`. Each is either media
chrome or an app-specific editor with no counterpart.

Three components use inline `style={{`: `MaskEditor`, `Select`,
`WebcamSettings`. Inline styles cannot be reached by a stylesheet and are
handled last, after the classes around them have settled.

## Sequencing

Each step leaves the app running and launchable.

1. **Adopt.** Dependency, imports, `appearance.ts`, picker in settings,
   crossfade rule. The app still uses its own CSS; tokens are merely available.
2. **Accent.** The 21 cyans, and delete the `:focus-visible` override.
3. **Shell.** `.app`, the sidebar → rail, the radius change, `.hero`'s
   backsplash. Verify the video corners here, not at the end.
4. **Components.** Swap in the order of the table above — primitives
   (`Select`, buttons, chips) before the panels that contain them.
5. **Sweep.** Remaining literals to tokens until the guard passes.
6. **Inline styles.** The three components above.

## Testing

`packages/app` already runs `vitest run`; vitest runs at `--maxWorkers=2`.

**The appearance module.** Same three assertions as the five-app rollout:
`resolveSurfaceId` and `resolveAccentId` return their defaults for `null`, `''`,
`'nope'`, `'constructor'` and `'__proto__'` and return real ids unchanged;
`applySurface('axi')` leaves no `data-axi-theme` while `applySurface('glass')`
sets it to `glass`; both round-trip through `localStorage`.

**The literal guard.** One test reads `styles.css` and asserts it contains no
hex colour literal. This is the only way to know the sweep actually finished
rather than nearly finished, and it keeps the file from regressing afterwards.
Its allowance is narrow and explicit: it matches `#rgb` / `#rrggbb` /
`#rrggbbaa` only, so the documented black-over-video `rgba()` gradients pass by
construction rather than by exemption.

**Not tested: whether it looks right.** No assertion here can catch a flat
surface that reads wrong or a chip that lost its meaning. The acceptance pass is
manual and covers, in all three surfaces:

- idle / setup state, live capture, and the summary panel
- every settings panel
- the mask editor and the webcam settings, the two inline-style survivors
- **the video corners under a live capture**, per the radius risk above

## Done when

- `styles.css` contains no hex literal and the guard test proves it
- axistream depends on `@axiapps/axi-design ^1.43.0` and imports all four
  stylesheets
- the accent and surface pickers work, defaulting to Electric Cyan on Axi
- a first launch after migration is visually near-indistinguishable from before,
  the primary button excepted
- the video corners match the frame radius in Axi, Flat and Glass on real
  hardware
