# Headless Hidden OBS — Design Spec

**Date:** 2026-06-23
**Status:** Approved for planning
**Scope:** Make AxiStream run its OBS sidecar **invisibly** on Linux by launching it inside a headless wlroots compositor (`cage` with the headless backend), so the user never sees an OBS window while capture and streaming — and the live idle preview — keep working. **In scope:** a headless `ObsLauncher` variant in the capture library, cage-detection + visible fallback, and app selection of it on Linux. **Out of scope:** Windows/macOS hidden mechanisms; bundling `cage`/OBS for shipped builds (a packaging concern, deferred with portable-OBS bundling).

## Background & feasibility

The walking-skeleton app currently launches OBS as a **visible** window (`FlatpakObsLauncher`), which breaks the intended "you only ever see AxiStream" experience. Three approaches were weighed (minimize-to-tray, offscreen/window-rules, headless/virtual-display); the user chose the headless/virtual-display approach for a guaranteed-invisible OBS that still renders (so the idle preview thumbnail stays live).

A feasibility spike (2026-06-23, Bazzite/KDE/Wayland, NVIDIA RTX 4070 Ti) established:
- `cage` and `gamescope` are present natively (no distrobox needed).
- **gamescope `--backend headless` segfaults** on this NVIDIA card (Vulkan DRM-modifier bug) — not usable.
- **`WLR_BACKENDS=headless cage -- <obs>` WORKS**: OBS boots inside a headless wlroots compositor (NVIDIA EGL/GLES2 context, `Platform: Wayland`, `Initializing OpenGL...`), the obs-websocket port is reachable (~5s), and no window appears. This retires the dominant "invisible-yet-alive on NVIDIA/Wayland" risk.
- No `xdg-desktop-portal-wlr` backend is installed → screen-cast requests route to the host **`xdg-desktop-portal-kde`** backend, which captures the **real** screen (not the nested compositor's output). Strongly reasoned; the end-to-end "headless OBS captures the real screen non-black" is the one residual item, confirmed in the implementation's first-run manual check.

## Architecture

OBS launching is already abstracted behind the capture library's `ObsLauncher` interface (`launch(args): ObsLaunchHandle`, `killApp()`), consumed by `ObsSidecar`. This change adds a headless launcher and selects it from the app — nothing else in the pipeline changes.

### New unit — `HeadlessCageObsLauncher` (Linux), in `@axistream/capture`
- `launch(args)` spawns `cage` with env `WLR_BACKENDS=headless`, `WLR_HEADLESS_OUTPUTS=1`, `WLR_LIBINPUT_NO_DEVICES=1`, and command-line `-- flatpak run com.obsproject.Studio <args>` (the same OBS flags the visible launcher passes — websocket port/password, `--multi`, `--disable-shutdown-check`, `--collection`).
- Implements `ObsLauncher` so `ObsSidecar` consumes it unchanged.
- **Detection + fallback:** if `cage` is not found on `PATH`, the launcher delegates `launch`/`killApp` to a wrapped fallback `ObsLauncher` (the visible `FlatpakObsLauncher`). Never a hard failure.
- **`killApp()`:** `flatpak kill com.obsproject.Studio` (ends OBS → cage's sole client exits → cage exits), plus killing the spawned `cage` child as a backstop. The websocket port closing is the teardown proof.

### App selection (`packages/app/src/main/index.ts`)
- On `process.platform === 'linux'`, construct `ObsSidecar` with `HeadlessCageObsLauncher` (wrapping `FlatpakObsLauncher` as fallback). Other platforms keep their existing launcher.
- An env escape hatch `AXISTREAM_OBS_VISIBLE=1` forces the visible launcher (debugging).

### Unchanged by design
`ObsSidecar`, `Provisioner`, `StreamController`, `PreviewPump`, the IPC layer, and the renderer are untouched. The first-run portal flow is identical: the screen-share dialog is an OS dialog rendered on the real KDE screen regardless of where OBS's window lives, so "approve once" works as today. Because headless cage renders continuously, `PreviewPump` screenshots work even when idle → the live idle preview thumbnail works (the payoff of this approach).

## Data flow (launch + teardown)

- **Launch:** app → `new ObsSidecar({ launcher: new HeadlessCageObsLauncher(new FlatpakObsLauncher()), … })` → `sidecar.start()` → headless launcher spawns `cage`(headless) → OBS → `ObsSidecar` waits for the websocket port (existing `waitForPort`, ~5s) → connects. If cage is absent or the port never opens, the visible fallback is used.
- **Teardown:** `sidecar.stop()` → `launcher.killApp()` → `flatpak kill com.obsproject.Studio` + kill spawned `cage` child → port closes.

## Error handling & edge cases

- **`cage` absent** → delegate to the visible `FlatpakObsLauncher`; log "OBS running in visible mode."
- **Headless backend fails / port never opens** within the readiness window → `ObsSidecar.start()` throws as today; the app catches and retries once with the visible fallback launcher, surfacing the visible-mode note.
- **Orphaned cage/OBS** → `killApp()` kills both (flatpak kill + cage child); startup also clears prior orphans via the existing pre-launch `killApp()`.
- **Non-Linux platform** → headless launcher is not selected; existing behavior unchanged.

## Testing strategy

- **Unit** (`@axistream/capture`, mocked spawn + cage-detection): `HeadlessCageObsLauncher.launch` builds the exact `cage` command + headless env + `flatpak run … <args>`; when cage-detection reports absent, `launch`/`killApp` delegate to the injected fallback launcher.
- **Integration (local, real OBS):** `ObsSidecar` with the headless launcher → websocket reachable → `GetVersion` succeeds → no visible OBS window appears → clean teardown leaves no orphaned cage/OBS process (port closed). First-run portal approval stays manual.
- **Manual first-run (the residual-risk confirmation):** with headless OBS, approve the portal once, confirm the capture renders the **real** screen (non-black `GetSourceScreenshot`) and the idle preview thumbnail updates while not streaming.
- All Vitest runs use the forks-pool 2-worker cap.

## Open items to resolve during planning

1. cage-detection mechanism for unit-testability — inject a `which(cmd): boolean` (or a resolved cage path) so tests don't shell out.
2. Exact env/arg ordering for `cage` (the spike used `WLR_BACKENDS=headless WLR_HEADLESS_OUTPUTS=1 WLR_LIBINPUT_NO_DEVICES=1 cage -- flatpak run … <args>`).
3. Whether the visible-fallback retry lives in the launcher (self-delegating) or in the app's start orchestration — pick the smaller, well-tested boundary during planning.
