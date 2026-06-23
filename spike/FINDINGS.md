# OBS-Sidecar-over-obs-websocket Spike — Findings

Spike of driving a bundled OBS Studio as a background sidecar over obs-websocket, as the cross-platform capture/encode/stream foundation for AxiStream. See plan: `docs/superpowers/plans/2026-06-23-obs-websocket-sidecar-spike.md`.

**Test rig (Linux):** Bazzite (Fedora Atomic, KDE Kinoite), Wayland session, Electron 42.4.1, Flatpak OBS Studio **32.1.2** (obs-websocket **5.7.3**, RPC v1), install size 537 MB.

**Windows:** not yet validated (no Windows machine on hand) — the plan's pass bar is both platforms.

## Results table

| Probe | Linux (Bazzite/Wayland) | Windows |
|-------|--------------------------|---------|
| 00 env / OBS located | PASS | not run |
| 01 launch + connect  | PASS | not run |
| 02 create source     | — | — |
| 02b portal persists  | — | — |
| 03 non-black frames  | — | — |
| 04 encoder control   | — | — |
| 05 RTMPS live        | — | — |

## Task 0 — env / OBS acquisition (Linux: PASS)
- Electron 42.4.1 boots cleanly; Wayland + KDE detected.
- OBS obtained via Flatpak `com.obsproject.Studio` (stable, 32.1.2, 537 MB installed). This is the realistic Linux bundling/acquisition story.

## Task 1 — launch sidecar + connect (Linux: PASS)
- **CLI-flag enable works headlessly.** Passing `--websocket_port` / `--websocket_password` to Flatpak OBS enabled the obs-websocket server with zero GUI interaction. This was the biggest headless-control unknown — resolved positively.
- Connected + authenticated via `obs-websocket-js` 5.0.8; `GetVersion` → OBS 32.1.2, obs-websocket 5.7.3, RPC v1, 151 available requests, PNG screenshot format supported.
- **Packaging finding — Flatpak teardown:** `flatpak run` launches OBS in a sandbox process tree; killing the `flatpak run` child orphans the real OBS (websocket port stayed open). Correct teardown is `flatpak kill com.obsproject.Studio`. Baked into `obs-launch.js`; re-run confirmed clean shutdown (port closed, exit 0). The real app's sidecar manager must use the same mechanism on Linux.

## Open risks still to validate
- Wayland PipeWire portal: does screen-share approval persist across restarts (one-time approval)? (Task 2)
- Does capture actually render non-black frames on Wayland? (Task 3, automated via GetSourceScreenshot)
- Encoder control depth — profile-based vs over-socket. (Task 4)
- End-to-end RTMPS to YouTube. (Task 5)
- Hidden operation: `--minimize-to-tray` behavior / whether OBS stays out of the way. (ongoing)
- The entire Windows half.
