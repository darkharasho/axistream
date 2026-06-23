# AxiStream Capture Provisioning — Design Spec

**Date:** 2026-06-23
**Status:** Approved for planning
**Scope:** How AxiStream gets a working, persistent screen-capture source into its bundled OBS, with at most one user interaction ever. This is the foundation the "three clicks to live" flow sits on. It does **not** cover the streaming UI, GW2 encoder presets, or privacy-mask editing — those are downstream specs that consume the `READY` capture this subsystem produces.

## Background

AxiStream drives a bundled OBS Studio as a sidecar over obs-websocket (decision recorded in project memory; validated end-to-end on Linux in `spike/FINDINGS.md`, including a live RTMPS stream to YouTube). A spike established the load-bearing constraint this spec resolves:

- **Runtime `CreateInput` capture sources never initialize on Wayland** — even with the real `RestoreToken` injected (spike probe 07).
- **A socket-built source that is persisted and reloaded renders correctly** — build the scene/source over obs-websocket → switch scene collections (forces OBS to save) → relaunch OBS with `--collection <name>` → the now config-loaded source initializes, prompts the xdg-desktop-portal screen-share dialog once, then renders. The restore token persists for silent re-launches (spike probe 08, visually confirmed).

This "build → persist → reload → one-time approval → silent thereafter" mechanism is the heart of the design.

## Decisions locked during brainstorming

1. **Capture target (v1):** whole monitor/display. Window capture is a later option. Privacy masks (separate spec) make whole-monitor capture safe.
2. **Foundation:** bundled OBS driven over obs-websocket (not obs-studio-node, which lacks Linux support).
3. **Isolation flavor: 1a (strong).** AxiStream bundles its **own portable OBS** per platform with its **own config directory** (OBS portable mode), so the user's personal OBS install is irrelevant and untouched. Heavier packaging is accepted in exchange for fully predictable behavior and control of the OBS version/plugins (including the Linux PipeWire capture plugin) we ship.

## Architecture

The provisioning subsystem lives in AxiStream's main process and is composed of three units with clear boundaries:

### `ObsSidecar` — OBS process lifecycle
Owns the bundled, portable OBS process.
- `start()` — launch the **bundled** OBS in portable mode (isolated config dir), with `--websocket_port <random-free>` / `--websocket_password <random>`, `--collection AxiStream`; wait for the socket to accept connections and for OBS to stop reporting "not ready."
- `client()` — the connected obs-websocket client, wrapped with a `callReady` retry helper that rides out OBS's startup/collection-switch "not ready" window.
- `restart()` — clean `stop()` + `start()`, used for the provisioning reload step.
- `stop()` — trigger a save, then platform-correct reliable kill.
- Emits `crashed` on unexpected exit and auto-restarts; recovers orphaned instances on `start()`.

**Teardown detail (from the spike):** a sandboxed/wrapped launcher can orphan the real OBS if you kill only the launcher child. `ObsSidecar` must kill the actual OBS process (e.g. by app id / portable config path), verified by the websocket port closing.

### `Provisioner` — capture-setup state machine
States: `UNPROVISIONED → BUILDING → AWAITING_APPROVAL → READY`, plus a `REPAIR` path.
- `status()` — derived from `CaptureConfig`.
- `provision(onApprovalNeeded)` — build the `AxiStream` collection over the socket (scene `Main` + capture source + mask placeholder sources), persist it, take the platform-appropriate activation branch (below), watch for the first non-black frame, mark `READY`.
- `repair()` — same flow when a stored token goes stale.

**Platform branch (hidden behind the one interface):**
- **Wayland:** build → persist (collection-switch forces save) → `ObsSidecar.restart()` onto `AxiStream` → config-loaded source triggers the portal → `onApprovalNeeded` fires so the UI tells the user to pick a screen + "Remember" → first non-black frame ⇒ `READY`. **The OS portal is the monitor picker** — AxiStream does not pre-select a monitor on Wayland.
- **Windows:** no portal. Enumerate displays in AxiStream's own UI, user picks one, `CreateInput monitor_capture` with that display → renders immediately (live, no reload) ⇒ `READY`. *(The "no reload needed" assumption is to be confirmed in the Windows spike; if Windows also needs the reload branch, the same Wayland path is reused minus the portal.)*

### `CaptureConfig` — persisted state
Stored as JSON in AxiStream's own app-data dir: `{ provisioned: boolean, platform, target?: { displayId | name }, collection: 'AxiStream' }`. The OBS **restore token lives inside the OBS collection** (OBS owns it); `CaptureConfig` records only provisioning status and the chosen target. Corrupt/missing file ⇒ treated as `UNPROVISIONED`.

## Data flow

**First run — Wayland:** start sidecar → `status: UNPROVISIONED` → `provision()` builds + persists the collection → `restart()` reloads OBS → portal dialog appears → `onApprovalNeeded` → user approves (picks screen, checks Remember) → non-black frame → `READY`, `CaptureConfig` saved.

**Every later run — Wayland:** start sidecar → OBS loads `AxiStream` → capture **auto-restores silently via the stored token** → `status: READY`. No dialog.

**First run — Windows:** start sidecar → `provision()` enumerates displays → user picks → `CreateInput monitor_capture` → renders → `READY`. Silent thereafter.

After provisioning, both platforms present an identical contract to the rest of the app: **capture is `READY`** and streamable.

## Error handling & edge cases

- **Portal denied / timed out:** stay `AWAITING_APPROVAL`; after a timeout fall back to `UNPROVISIONED` with a "Set up capture again" retry. Never mark `READY` without a verified frame.
- **Stale restore token** (monitor unplugged, layout/resolution change, token expired): source loads but renders black/errors; `Provisioner` detects "no frames after start" → `REPAIR` → rebuild + reload → re-trigger the one-time portal → re-approve → `READY`.
- **OBS "not ready":** every request goes through the `callReady` retry wrapper.
- **OBS crash / orphan:** `ObsSidecar` detects unexpected exit; next `start()` kills orphans before relaunching; mid-stream crash surfaces to the UI, never a silent hang.
- **Websocket port in use:** pick a random free port per launch, passed via flags — never hardcode 4455.
- **OBS version:** bundled ⇒ fixed; `start()` still asserts `GetVersion` matches the expected build and refuses mismatches.
- **Multiple AxiStream instances:** single-instance lock so two copies don't fight over the sidecar.
- **"Remember" not honored by a compositor:** detect repeated `AWAITING_APPROVAL` across launches, log it, keep the guided path rather than looping silently.

## Testing strategy

- **`Provisioner` state-machine unit tests** (mocked socket client): all transitions, `REPAIR`, portal-denied/timeout, stale-token detection. Fast, deterministic — the bulk of coverage.
- **`CaptureConfig` round-trip tests:** persist → reload → status, including corrupt/missing-file recovery.
- **`ObsSidecar` integration tests** (real bundled OBS, throwaway config dir): launch → websocket reachable → `GetVersion` matches → clean teardown → no orphan → random port respected.
- **Provisioning integration test** (spike probes, productized): build → persist → reload → assert a non-black `GetSourceScreenshot` (capture `READY`).
- **CI reality (explicit):**
  - The **silent-restore path** is automatable via a **pre-seeded collection + restore-token fixture** (a returning user) on a Wayland session in CI.
  - The **first-run portal approval** cannot be automated (OS dialog) → documented **manual/local** test script, not CI-gated.
  - Windows-branch tests run on a Windows runner; the Wayland reload branch is skipped there.
- **Isolation:** every test uses a fresh disposable OBS config dir — never the developer's real OBS — guaranteed by the bundled-portable design.

## Out of scope (downstream specs)

- Streaming control / "three clicks to live" UI.
- GW2 encoder/bitrate presets (applied via OBS profiles, per spike finding).
- Privacy-mask placement/editing (this spec only reserves mask placeholder sources in the scene).
- OBS acquisition/bundling pipeline per platform (how the portable OBS is built/vendored/signed) — a packaging concern referenced here but specified separately.
- Windows end-to-end validation (a parallel spike).

## Open items to resolve during planning

1. Exact persistence trigger for "force save the collection" over the socket (collection-switch was used in the spike; confirm the minimal reliable call).
2. Confirm whether Windows needs the reload branch (Windows spike).
3. Portable-OBS layout per platform and how `ObsSidecar` locates it (ties into the separate packaging spec).
