# Game-Audio Plugin Install (Settings) — Design

**Date:** 2026-07-06
**Status:** Approved (design); pending implementation plan
**Scope:** Spec A of per-app game audio: an optional, app-handled install of
the OBS PipeWire audio-capture plugin from Settings, with status detection
and an app-relaunch activation step. Spec B (the actual "AxiStream Game
Audio" source + app picker) follows after the manual smoke test records the
plugin's input-kind ids.

## Problem

Per-app game audio needs the `PipeWire Audio Capture` OBS plugin, which the
OBS flatpak does not bundle — it's a separate flathub extension
(`com.obsproject.Studio.Plugin.PipeWireAudioCapture`; verified present on
flathub, absent from the local OBS plugin dir). AxiStream's pitch is that
users never touch OBS or a terminal, so the app must offer the install
itself — optional, from Settings, with honest status.

## Facts that shape the design

- OBS here is the **system** flatpak, but flatpak resolves extensions
  across installations — a `--user` install of the plugin works with the
  system OBS and needs **no password**. `--system` install triggers a
  polkit dialog (works only when a desktop polkit agent is running).
- A newly installed plugin loads only when OBS (re)starts. An in-place OBS
  bounce mid-session drags the user through the Wayland portal approval
  flow (documented headless-cage limitation), but a full app relaunch
  restores capture silently from the persisted restore token. So
  activation = **relaunch AxiStream**, not OBS surgery.
- `GetInputKindList` over obs-websocket reports loaded source kinds — the
  ground truth for "plugin active", and the way to capture the plugin's
  exact kind ids for spec B (they are not guessed in this spec).

## Non-goals

The game-audio source itself, app picker, desktop-audio interplay (spec B);
uninstall UX; non-flatpak OBS installs; Windows/macOS.

## Design

### Status model (shared state)

```ts
export type GameAudioPluginStatus = 'missing' | 'installing' | 'installed' | 'ready' | 'error' | 'unsupported'
// AppState.gameAudioPlugin: { status: GameAudioPluginStatus; error: string | null }
```

- `unsupported` — no `flatpak` binary on PATH (dev boxes, future Windows).
- `missing` — flatpak present, extension not installed.
- `installing` — spawn in flight.
- `installed` — on disk but not loaded in this OBS session → UI shows
  "Restart AxiStream to activate" + Restart button.
- `ready` — `GetInputKindList` contains a PipeWire-audio kind.
- `error` — install failed; `error` carries the tail of flatpak's output.

### PluginInstaller (new, main — `packages/app/src/main/PluginInstaller.ts`)

Injected deps `{ exec(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; output: string }> }`
(real impl wraps `child_process.execFile`; tests fake it). Methods:

- `detectInstalled(): Promise<'missing' | 'installed' | 'unsupported'>` —
  `flatpak info com.obsproject.Studio.Plugin.PipeWireAudioCapture`
  (exit 0 → installed; nonzero → missing; spawn ENOENT → unsupported).
- `install(): Promise<{ ok: boolean; error?: string }>` —
  `flatpak install --user --noninteractive flathub <REF>` (10 min timeout);
  on failure, one retry with `--system --noninteractive`; on final failure
  return the last ~500 chars of output as `error`. Never throws.

### OBS-side readiness probe (main, in index.ts wiring)

After OBS is up on a provisioned boot: call `GetInputKindList`
(best-effort) and log the full list with `console.info('[game-audio] input kinds', kinds)`
— this log line is the spec-B artifact. `ready` = any kind matching
`/pipewire.*audio|audio.*pipewire/i` **excluding** the built-in screen
kind `pipewire-screen-capture-source`. Combined status derivation at boot:
unsupported → `unsupported`; installed + kind present → `ready`;
installed + absent → `installed`; else `missing`.

### IPC / preload / relaunch

- Channels: `getGameAudioPluginStatus(): Promise<AppState['gameAudioPlugin']>`,
  `installGameAudioPlugin(): Promise<void>` (drives status transitions via
  `setState`), `relaunchApp(): Promise<void>` (`app.relaunch(); app.quit()`).
- Install handler: set `installing` → `await installer.install()` → on ok
  set `installed` (relaunch will flip it to `ready`), on failure set
  `error` with the message. Guard against concurrent installs (ignore
  while `installing`).
- Relaunch must not bypass the quit-while-live guard: if
  `stream.isLive()`, the `relaunchApp` handler no-ops. The Settings
  Restart button is also hidden while live — belt and suspenders.

### UI — SettingsScreen: "Game audio" section

New `GameAudioSettings.tsx` component (mounted in `SettingsScreen` under
Audio) rendering by status:

- `unsupported`: muted text "Per-app game audio requires the OBS flatpak."
- `missing`: one-line explainer ("Capture only your game's audio — needs a
  free OBS plugin.") + **Install plugin** button.
- `installing`: disabled button with spinner ("Installing…").
- `installed`: "Installed — restart AxiStream to activate." + **Restart
  AxiStream** button (hidden while LIVE/RECONNECTING/GOING_LIVE).
- `ready`: "Ready ✓" (green), no buttons.
- `error`: the error text (truncated, monospace) + **Retry install**.

## Error handling

Everything best-effort: detection failures degrade to `missing`
(install is idempotent — flatpak treats already-installed as success);
probe failures leave status at the flatpak-derived value; install spawn
errors → `error` state, never a throw; nothing blocks boot or go-live.

## Testing

- **PluginInstaller** (fake exec): detect installed/missing/unsupported;
  install happy path issues the exact `--user --noninteractive` argv;
  user-failure → system retry with exact argv; both fail → `ok: false`
  with output tail; timeout surfaces as failure; already-installed exit 0
  path.
- **Status derivation** (pure function extracted for testability:
  `deriveGameAudioStatus(flatpak: 'missing'|'installed'|'unsupported', kinds: string[]): GameAudioPluginStatus`):
  the four combinations above + screen-capture kind excluded.
- **GameAudioSettings** (render): one assertion per status; install click
  calls the API; restart button hidden while live.
- **IPC contract**: new channels registered.
- **Manual smoke (human):** click Install on this box → flatpak extension
  appears (`flatpak info` succeeds); restart → status `ready`; copy the
  `[game-audio] input kinds` log line into the spec-B design.
