# AxiStream Walking-Skeleton UI — Design Spec

**Date:** 2026-06-23
**Status:** Approved for planning
**Scope:** The first UI slice — the Electron app shell + the core "launch → capture setup → paste key → Go Live → live status" flow — that turns the headless `axistream-capture` library into a demoable app that actually streams. **In scope:** app shell, Stream screen, Settings screen, secure key storage, live status with preview. **Out of scope (later specs):** GW2 encoder presets, privacy-mask editor, settings polish/auto-update/crash-reporting. These appear in the UI as visible-but-disabled "SOON" entries.

## Background

The `axistream-capture` library (merged to `main`) is the headless engine: it runs OBS as a sidecar over obs-websocket and exposes `ObsSidecar`, `Provisioner` (build → persist → reload → one-time Wayland portal → silent restore), `CaptureConfig`, `callReady`, `isNonBlackPng`. This spec designs the UI that drives it. The library stays UI-agnostic; the app is a thin, secure shell.

## Locked decisions (from brainstorming)

1. **First slice = walking-skeleton MVP**: Stream + Settings only; masks/presets deferred.
2. **Stream key handling**: securely persisted via Electron `safeStorage` (encrypted at rest), with an explicit **Forget** control. So a returning user is one click from live.
3. **Live status**: health stats (bitrate, dropped frames, duration, reconnecting) **plus a live preview thumbnail** (periodic `GetSourceScreenshot`).
4. **Visual direction = synthesis**: A **labeled sidebar shell** for navigation/structure + a **cinematic, preview-forward Stream screen** (the live preview is the hero, chrome floats over it). Dark theme, cyan accent, monospace for stats. Frameless Electron window with custom title bar. (Mockup references: `mcp` renders during the 2026-06-23 brainstorm — Direction A shell + Direction G Stream hero.)
5. **Architecture = hybrid command/event IPC**, built with **electron-vite** (Vite + React + TS).

## Architecture & project structure

**Repo → npm workspaces** (the library is already built/tested at the repo root):
- `packages/capture/` — the existing `axistream-capture` library, moved as-is (`git mv` src/, test/, configs). Remains independently testable; keeps its 22-test suite.
- `packages/app/` — the Electron app (electron-vite); depends on `@axistream/capture`.

**Three layers in `packages/app`:**

- **main/** (Node) — owns the library + orchestration:
  - `CaptureService` — wraps `ObsSidecar` + `Provisioner`; exposes `provision()`/status; forwards `onApprovalNeeded`; emits `crashed`.
  - `StreamController` — `goLive(key)` / `stop()`; sets the YouTube RTMPS service; polls OBS `GetStreamStatus` (~1 Hz) for live stats; derives live/reconnecting/timeout.
  - `KeyStore` — YouTube key persistence via `safeStorage` (+ `forget()`, + unavailable-backend fallback).
  - `PreviewPump` — periodic `GetSourceScreenshot` (~1–2 Hz) → pushes frames; runs only in READY/LIVE; pauses when the window is hidden.
  - `ipc.ts` — registers command handlers and emits state/stats/preview events.
- **preload/** — typed `contextBridge` API (`window.axi`); `contextIsolation: true`, no `nodeIntegration`.
- **renderer/** (React + TS) — the sidebar shell + screens; a small store mirroring pushed events. Renderer touches only `window.axi`, never Node/OBS.

## Screens & states

**Two screens:** **Stream** (hero) and **Settings** (key management, re-run capture setup / re-pick monitor via `repairCapture()`, engine status, app version). Masks/Presets are disabled "SOON" sidebar entries.

**The Stream screen is a state machine** driven by pushed `phase`:

| Phase | UI |
|-------|----|
| `SETTING_UP` | Preview area replaced by a "Set up your capture" CTA (one-time, reassuring copy) → `provision()` |
| `AWAITING_APPROVAL` | Overlay: "Approve the screen-share dialog…" (from `onApprovalNeeded`) |
| `NEEDS_KEY` | Capture ready, no key; bottom shows "Paste your YouTube stream key" input → `saveKey()` → READY |
| `READY` | Canonical screen: live preview hero, capture meta, masked key + Forget, **Go Live** enabled |
| `GOING_LIVE` | Transient; button shows "Starting…" (with a timeout guard) |
| `LIVE` | Red **LIVE** badge + elapsed timer, "YouTube · RTMPS", live health chips, red **End Stream**; sidebar pill → "On air" |
| `RECONNECTING` | Warning banner over the LIVE layout (OBS auto-reconnecting) |
| `ERROR` | Error message + Retry; engine pill red when engine-level |

**Launch flow:** main boots `CaptureService` → reads provisioned (`CaptureConfig`) + key (`KeyStore`) → emits the initial phase. Returning user with capture + key lands directly on `READY` (one click to live).

## Data flow & IPC contract

**Commands** (renderer → main, `invoke`/`handle`, promises):
- `getInitialState(): AppState`
- `provision(): void` — progress via events
- `saveKey(key: string): void` / `forgetKey(): void`
- `goLive(): void` — uses the stored key (requires one)
- `stopStream(): void`
- `repairCapture(): void`

**Events** (main → renderer, pushed):
- `onState(cb)` → `phase` + meta (below)
- `onStats(cb)` → ~1 Hz while live: `{ bitrateKbps, droppedFrames, durationMs, encoder, cpuPct, reconnecting }`
- `onPreview(cb)` → ~1–2 Hz base64 PNG (READY + LIVE)

**State model:**
```ts
type StreamPhase =
  | 'SETTING_UP' | 'AWAITING_APPROVAL' | 'NEEDS_KEY' | 'READY'
  | 'GOING_LIVE' | 'LIVE' | 'RECONNECTING' | 'ERROR'

interface LiveStats {
  bitrateKbps: number; droppedFrames: number; durationMs: number;
  encoder: string; cpuPct: number; reconnecting: boolean;
}

interface AppState {
  phase: StreamPhase
  capture: { sourceLabel: string; width: number; height: number; fps: number } | null
  keyMasked: string | null   // "····7f3a" or null
  stats: LiveStats | null
  error: string | null
}
```

**Key sequences:**
- **Launch** → boot `CaptureService` (`ObsSidecar.start`) → initial phase.
- **Provision** → `AWAITING_APPROVAL` → OS approval → `READY`; `PreviewPump` starts.
- **Save key** → `NEEDS_KEY` → `READY`.
- **Go live** → `GOING_LIVE` → `StreamController` sets RTMPS + `StartStream` → poll `GetStreamStatus` → `LIVE`; `onStats` flows; `outputReconnecting` → `RECONNECTING`.
- **Stop** → `READY`.

## Error handling & edge cases (app-level)

- **Engine won't start** → `ERROR` + Retry; sidebar pill red; actions blocked.
- **Provision denied / portal timeout** → library returns `AWAITING_APPROVAL` with no frame → "Setup didn't finish — try again" → `SETTING_UP`.
- **Go Live fails** (bad key, RTMPS handshake, `StartStream` error) → timeout out of `GOING_LIVE` → `ERROR` banner → `READY`.
- **Stream drops mid-broadcast** → `RECONNECTING`; recovers → `LIVE`; gives up → `ERROR` → `READY`, preserving the elapsed-time message.
- **OBS crashes while live** → `CaptureService` `crashed` → `ERROR` "Stream engine crashed," auto-restart attempt → `NEEDS_KEY`/`READY`.
- **Invalid/empty key** → inline validation before Go Live enables.
- **`safeStorage` unavailable** → don't persist; tell the user "key won't be saved on this system" (paste each launch).
- **Quit while live** → confirm dialog "You're still live — end stream and quit?"

## Testing strategy

- **Renderer state-machine tests** (Vitest + React Testing Library, `window.axi` mocked): each `phase` renders the right UI; Go Live disabled without a key; pushed events drive transitions; key-input validation.
- **Store/reducer unit tests:** event payloads → correct `AppState`.
- **Main-process unit tests** (deps injected, no real OBS): `KeyStore` (safeStorage mocked + unavailable fallback), `StreamController` (`GetStreamStatus` → stats mapping, live/reconnecting/timeout), `PreviewPump` (emits frames, pauses when hidden).
- **IPC contract test:** every `window.axi` command has a registered main handler with matching types (catches preload/main drift).
- **Integration (local, real OBS):** Playwright-for-Electron boots the app and asserts it reaches `READY`, reusing the library's proven live path. First-run portal approval stays **manual/local**; the returning-user path (provisioned + key) is automatable.
- **Reuse:** `@axistream/capture` keeps its own suite; app tests cover the shell/UI/orchestration. All runs use the forks-pool 2-worker cap.

## Out of scope (downstream specs)

- GW2 encoder/bitrate presets (OBS profiles) — the `Presets` screen.
- Privacy-mask editor — the `Masks` screen (the capture library already reserves the `Main` scene; masks add scene sources).
- Auto-update, code signing/notarization, crash reporting (public-release tail).
- Windows/macOS end-to-end validation of the app shell (parallel to the library's Windows spike).

## Open items to resolve during planning

1. Renderer store choice (zustand vs a small `useReducer` + context) — pick during planning; both satisfy the contract.
2. Exact `cpuPct` source (OBS `GetStreamStatus` exposes encoding load fields; confirm the field) — fall back to omitting CPU if unavailable.
3. Frameless-window custom title-bar behavior per platform (drag region, controls) — standard electron-vite handling.
4. Where `KeyStore` writes (app `userData` dir) and the masked-display derivation.
