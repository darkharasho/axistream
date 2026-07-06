# Per-App Game Audio Source (Spec B) — Design

**Date:** 2026-07-06
**Status:** Approved (design); pending implementation plan
**Scope:** The "AxiStream Game Audio" source: capture only the game's audio
via the PipeWire audio-capture plugin (installed by spec A,
`docs/superpowers/specs/2026-07-06-game-audio-plugin-install-design.md`),
with an app picker and opinionated desktop-audio interplay.

## Ground truth (discovered live, 2026-07-06 — not guesses)

Probed against a running OBS with the plugin loaded:

- Input kind: **`pipewire_audio_application_capture`** (also loaded:
  `pipewire_audio_input_capture`, `pipewire_audio_output_capture` — unused
  here).
- Default settings: `{ CaptureMode: 0, ExceptApp: false, MatchPriorty: 0, apps: [] }`
  (`MatchPriorty` is the plugin's own spelling).
- `CaptureMode` enum: `0` = "Single application", `1` = "Multiple applications".
- `MatchPriorty` enum: `0` = "Match by executable name, fallback to app
  name", `1` = the reverse.
- **`TargetName`** is both the single-app setting key and an enumerable
  property: `GetInputPropertiesListPropertyItems(input, 'TargetName')`
  returns the currently-running audio apps as `{ itemName, itemValue }` —
  the exact shape our device pickers already consume.

## Problem

Desktop audio streams everything — Discord pings, browser tabs, music.
The differentiated experience is "viewers hear GW2 and the mic, nothing
else." The plugin is installed (spec A); this spec wires it into a source,
settings, and UI.

## Non-goals

Multiple-app capture (`CaptureMode: 1`); per-source volume/meters;
auto-detecting GW2's executable name before it has ever produced audio;
Windows/macOS.

## Design

### Settings (StreamSettings)

- `gameAudioEnabled: boolean`, default `false` (boolean-validated like
  `desktopEnabled`).
- `gameAudioTarget: string | null`, default `null` (string-or-null like
  `micDevice`). The value is the plugin's app identifier (executable name
  under `MatchPriorty: 0`, e.g. what GW2's Proton process reports while
  running).

### GameAudioController (new, main — `packages/app/src/main/GameAudioController.ts`)

House pattern: `{ client(): { call(req, data?) } }` deps, best-effort
throughout (`console.warn`, never throw). Constants:
`GAME_AUDIO = 'AxiStream Game Audio'`, `GAME_AUDIO_KIND = 'pipewire_audio_application_capture'`.

- `ensure(settings: { gameAudioEnabled; gameAudioTarget }): Promise<void>` —
  idempotent reconcile, called at boot and after every capture rebuild
  (same lifecycle points as `ensureAudioInputs`/`applyMasks`):
  - If the input is missing AND `gameAudioEnabled`: `CreateInput` in scene
    `Main` with `{ CaptureMode: 0, TargetName: gameAudioTarget ?? '', MatchPriorty: 0 }`.
    (No input is created while the feature has never been enabled — zero
    OBS footprint until opted in.)
  - If the input exists: `SetInputSettings` (overlay) with the current
    target, re-add the scene item if a rebuild dropped it (the
    GetSceneItemId-fail → CreateSceneItem recovery, same as masks).
  - Mute state = `!gameAudioEnabled` (`SetInputMute`) — disabled means
    muted, not removed, mirroring desktop/mic semantics.
  - If the kind isn't loaded (plugin missing), every call fails
    best-effort — no special casing needed, but callers gate on plugin
    status `ready` to avoid noise.
- `listApps(): Promise<AudioDevice[]>` —
  `GetInputPropertiesListPropertyItems(GAME_AUDIO, 'TargetName')` mapped to
  `{ id: itemValue, name: itemName }`; `[]` on error. (Reuses the
  `AudioDevice` shape so the UI picker code paths match the device
  pickers.) Requires the input to exist — `ensure` runs before the UI can
  reach the picker (see UI gating below).
- `setTarget(target: string): Promise<void>` — `SetInputSettings`
  `{ TargetName: target }` overlay.
- `setEnabled(enabled: boolean): Promise<void>` — mute toggle.

### State / IPC / preload

- `AppState.audio` gains `gameAudioEnabled: boolean` and
  `gameAudioTarget: string | null` (it's the audio slice — belongs with
  desktop/mic, not with the plugin-install state).
- Channels + `AxiApi`/`IpcHandlers`: `setGameAudioEnabled(enabled)`,
  `setGameAudioTarget(target)`, `getGameAudioApps(): Promise<AudioDevice[]>`.

### Wiring (index.ts)

- Construct `gameAudio = new GameAudioController({ client })`.
- Handlers:
  - `setGameAudioEnabled`: persist; `await gameAudio.ensure(...)` (creates
    the input on first enable) then `setEnabled`; **opinionated interplay:**
    when enabling and `desktopEnabled` is true, also run the existing
    desktop-disable path (persist `desktopEnabled: false`, mute the desktop
    input, setState) so viewers don't hear the game twice. Disabling game
    audio does NOT auto-re-enable desktop.
  - `setGameAudioTarget`: persist; `setTarget`.
  - `getGameAudioApps`: `gameAudio.listApps()`.
- Boot (provisioned branch) + after provision/repair/switchSource: after
  the masks re-apply, `await gameAudio.ensure(settings.load())` — only
  when `state.gameAudioPlugin.status === 'ready'` (avoids error noise when
  the plugin isn't loaded).
- Boot state: audio slice includes the two new fields.

### UI — GameAudioSettings (extend spec A's component)

When plugin status is `ready`, instead of the bare "Ready ✓" line:

- A "Game audio" checkbox row (mirroring the desktop/mic rows) bound to
  `audio.gameAudioEnabled` → `setGameAudioEnabled`.
- When enabled: an app `<select>` fed by `getGameAudioApps()` (fetched when
  enabled, null-until-loaded like the device pickers), with
  `staleOption`-style handling — label **'Saved app (not running)'** — via a
  small generalization: `staleOption(saved, devices, label?)` gains an
  optional label parameter (default stays 'Saved device (unavailable)').
- Hint text: "Pick Guild Wars 2 while it's running. Desktop audio turns
  off automatically — game audio replaces it."
- All other plugin statuses render exactly as spec A shipped them.

## Error handling

Everything best-effort. `ensure` with a null target creates the input with
an empty `TargetName` (captures nothing until a target is picked — silent,
not broken). Plugin regressing to not-loaded (extension uninstalled
manually): status derivation flips off `ready`, UI reverts to the install
flow, `ensure` calls fail silently. Nothing blocks boot or go-live.

## Testing

- **GameAudioController** (recorded fake client): first-enable creates the
  input with exact kind/settings; existing input gets SetInputSettings +
  mute, not a duplicate CreateInput; scene-item recovery after rebuild;
  listApps maps items and returns [] on error; throwing client swallowed.
- **StreamSettings**: the two new fields default/persist/validate.
- **index-level interplay is wiring** (no harness): covered by review, like
  the sibling handlers; the desktop-disable path itself is already tested.
- **device-options**: `staleOption` label parameter (default unchanged —
  regression assertion on existing tests).
- **GameAudioSettings** (render): ready+disabled shows the toggle; enabling
  calls the API; enabled shows the picker fed by `getGameAudioApps`;
  saved-but-not-running renders 'Saved app (not running)'; non-ready
  statuses unchanged (regression).
- **IPC contract**: three new channels.
- **Manual smoke (human):** with GW2 running, enable game audio, pick it,
  go live (or monitor the stream): only game + mic audible, Discord/music
  absent; desktop audio toggle visibly switched off; survives an app
  restart.
