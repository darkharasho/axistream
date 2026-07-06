# "What Viewers Hear" Checkbox List — Design

**Date:** 2026-07-06
**Status:** Approved (design + rendered mockup); pending implementation plan
**Scope:** Replace the desktop-audio toggle and the single-app game-audio
picker with one styled checkbox list: **All desktop audio** XOR a
multi-select of running apps (plugin's multiple-application capture mode).
Supersedes the single-target UX of
`2026-07-06-game-audio-source-design.md`; the plugin-install flow
(spec A) is unchanged.

## Ground truth (plugin source, dimtpap/obs-pipewire-audio-capture)

- Multi-app mode: `CaptureMode: 1`. Selected apps live in settings key
  **`apps`** — an obs_data array whose items are objects
  `{ value: '<app name>', hidden: false, selected: false }`; the plugin
  reads only `value` (`obs_data_get_string(item, "value")`,
  pipewire-audio-capture-app.c:1020).
- Running-app enumeration property in multi mode: **`AppToAdd`**
  (`GetInputPropertiesListPropertyItems(GAME_AUDIO, 'AppToAdd')`).
- `MatchPriorty: 0` (executable name first) and `ExceptApp: false`
  (capture the selections, not everything-except) stay as-is.

## UX (as rendered in the approved mockup)

Inside the Audio settings card:

```
Audio
┌──────────────────────────────────────────────┐
│ ☐ All desktop audio — everything your        │
│   speakers play                              │
│   [Output device ▾]        (only when All ✓) │
│ ─ ONLY THESE APPS ──────────────────────  ↻  │
│ ☑ Guild Wars 2  (not running)                │
│ ☐ Discord                                    │
│ ☐ Firefox                                    │
└──────────────────────────────────────────────┘
Pick your game to keep Discord and music off the stream.
Checking an app switches off desktop audio automatically.
☑ Microphone (+ device picker — unchanged)
```

- **Mutually exclusive by rule, not disabling:** checking All clears the
  app selections; checking any app unchecks All. Unchecking everything is
  legal (mic-only stream), same as desktop-off today.
- App rows = live enumeration (`AppToAdd`) merged with the saved selection;
  saved apps not currently running render checked with an amber
  **"not running"** pill (they resume capturing when the app reappears —
  the plugin matches by name at runtime).
- **↻ refresh** re-enumerates without toggling anything (fixes the
  fetched-once gap from the spec-B review).
- Plugin not `ready`: the list renders only the All row (+ device picker),
  and the spec-A install/restart flow renders where the app rows would be.
  The Game audio section in `GameAudioSettings` is absorbed into this list;
  the component keeps the install/restart statuses only.

## Model changes

### StreamSettings

- **New:** `gameAudioApps: string[]`, default `[]`. Validation: array of
  non-empty strings (drop others), de-duplicated, cap 16.
- **Removed:** `gameAudioEnabled`, `gameAudioTarget`. **Migration inside
  `load()`:** when the file has no `gameAudioApps` key but legacy
  `gameAudioEnabled === true` and a non-empty `gameAudioTarget` string,
  return `gameAudioApps: [gameAudioTarget]`; otherwise `[]`. Legacy keys
  are ignored thereafter (they get dropped on the next `save`).
- Invariant (enforced by handlers, asserted in review, not in load):
  `gameAudioApps.length > 0 ⇒ desktopEnabled === false`.

### Shared state

`AppState.audio`: `gameAudioEnabled`/`gameAudioTarget` replaced by
`gameAudioApps: string[]` (INITIAL_STATE `[]`). Channels: `setGameAudioApps(apps: string[])`
replaces `setGameAudioEnabled`/`setGameAudioTarget`; `getGameAudioApps`
keeps its name/shape (returns running apps as `AudioDevice[]`).

### GameAudioController

**Amendment (2026-07-06 final review):** The input is created muted with an
empty selection at the first plugin-ready boot — enumeration (`AppToAdd`)
requires the input to exist. The previous "zero footprint" design (early-return
when selection is empty and input is missing) caused a deadlock where fresh
users could never see any rows.

- `ensure(s: { gameAudioApps: string[] })` — always creates the input when
  missing (empty-apps, muted), then reconciles settings (scene-item recovery;
  muted when `gameAudioApps.length === 0`). Input settings become
  `{ CaptureMode: 1, apps: s.gameAudioApps.map((value) => ({ value, hidden: false, selected: false })), MatchPriorty: 0 }`.
- `setTarget` removed; selection changes go through `ensure` (the handler
  always calls it with the full settings — one code path).
- `listApps()` switches the property name to `'AppToAdd'`.

### Wiring (index.ts)

- `setGameAudioApps(apps)` handler: sanitize (trim, drop empties, dedupe,
  cap 16), persist, `await gameAudio.ensure(settings.load())`, and when
  `apps.length > 0 && state.audio.desktopEnabled` run the desktop-off path
  (persist + mute + same single `setState` carrying both fields).
  Conversely `setDesktopEnabled(true)` now also clears `gameAudioApps`
  (persist `[]`, `ensure` → mutes the input, single `setState`) — the
  exclusivity works from both directions.
- Boot/rebuild `ensure` calls: unchanged locations, gated on plugin
  `ready`, now passing the migrated settings.

### UI

- `AudioSettings.tsx` owns the whole list (it already owns desktop + mic):
  renders the All row (checkbox + nested output-device picker when
  checked), the "Only these apps" divider with refresh, and the app rows —
  `checked = gameAudioApps.includes(app)`; toggling computes the next
  array and calls `setGameAudioApps`. Apps section renders only when
  plugin status is `ready` (needs `gameAudioPlugin` passed in); otherwise
  the install flow (`GameAudioSettings`, reduced to install/restart
  states) renders in its place.
- Row list = `union(runningApps, gameAudioApps)` sorted running-first;
  members of `gameAudioApps` absent from the enumeration get the
  "not running" pill.
- Styling per the mockup: bordered rounded group, hover rows, cyan accent
  checkboxes, amber pill, uppercase divider label, ↻ ghost button.

## Error handling

All best-effort as before. `setGameAudioApps` with a junk payload
sanitizes rather than rejects. Enumeration failure → running list `[]` →
saved apps all show "not running" (truthful). Migration never throws
(malformed legacy values → `[]`).

## Testing

- **GameAudioController:** CaptureMode 1 + exact `apps` array shape on
  create AND update; empty selection + missing input creates the input (empty
  apps) and mutes it (enumeration deadlock fix); existing input + empty
  selection mutes; `AppToAdd` enumeration; regression of scene-item
  recovery / swallow.
- **StreamSettings:** default, round-trip, sanitize (dedupe/cap/drop
  non-strings), and the legacy migration matrix (enabled+target → [target];
  enabled without target → []; disabled+target → []; new key present →
  legacy ignored).
- **index wiring:** review-verified (no harness), both exclusivity
  directions explicitly on the checklist.
- **AudioSettings (render):** All checked ↔ device picker visible; checking
  an app calls `setGameAudioApps` with the union and unchecks All in the
  pushed state (assert via the axi call args); "not running" pill for
  saved-but-absent apps; refresh re-calls `getGameAudioApps`; plugin not
  ready → app section replaced by install flow.
- **Manual smoke:** GW2 + Discord selected together stream both, music
  stays off; checking All flips back to desktop mode with device picker.
