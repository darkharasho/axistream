# OBS-Sidecar-over-obs-websocket Spike — Findings

Spike of driving a bundled OBS Studio as a background sidecar over obs-websocket, as the cross-platform capture/encode/stream foundation for AxiStream. See plan: `docs/superpowers/plans/2026-06-23-obs-websocket-sidecar-spike.md`.

**Test rig (Linux):** Bazzite (Fedora Atomic, KDE Kinoite), Wayland session, Electron 42.4.1, Flatpak OBS Studio **32.1.2** (obs-websocket **5.7.3**, RPC v1), install size 537 MB.

**Windows:** not yet validated (no Windows machine on hand) — the plan's pass bar is both platforms.

## Results table

| Probe | Linux (Bazzite/Wayland) | Windows |
|-------|--------------------------|---------|
| 00 env / OBS located | PASS | not run |
| 01 launch + connect  | PASS | not run |
| 02 create source     | PASS (created over socket) | not run |
| 02b portal persists  | YES (approved + remembered, restore token works) | NA |
| 03 non-black frames  | PASS (via existing source; new-source caveat below) | not run |
| 04 encoder control   | — | — |
| 05 RTMPS live        | — | — |

## Task 0 — env / OBS acquisition (Linux: PASS)
- Electron 42.4.1 boots cleanly; Wayland + KDE detected.
- OBS obtained via Flatpak `com.obsproject.Studio` (stable, 32.1.2, 537 MB installed). This is the realistic Linux bundling/acquisition story.

## Task 1 — launch sidecar + connect (Linux: PASS)
- **CLI-flag enable works headlessly.** Passing `--websocket_port` / `--websocket_password` to Flatpak OBS enabled the obs-websocket server with zero GUI interaction. This was the biggest headless-control unknown — resolved positively.
- Connected + authenticated via `obs-websocket-js` 5.0.8; `GetVersion` → OBS 32.1.2, obs-websocket 5.7.3, RPC v1, 151 available requests, PNG screenshot format supported.
- **Packaging finding — Flatpak teardown:** `flatpak run` launches OBS in a sandbox process tree; killing the `flatpak run` child orphans the real OBS (websocket port stayed open). Correct teardown is `flatpak kill com.obsproject.Studio`. Baked into `obs-launch.js`; re-run confirmed clean shutdown (port closed, exit 0). The real app's sidecar manager must use the same mechanism on Linux.

## Task 2 — create capture source over socket (Linux: PASS, with a key caveat)
- Screen-capture input kind on KDE/Wayland OBS 32 is **`pipewire-screen-capture-source`** (the plan's guessed `pipewire-desktop-capture-source` was wrong — discovered via `GetInputKindList`).
- `CreateInput` over obs-websocket **does create** the source — but on Wayland it does **NOT trigger the xdg-desktop-portal screen-share handshake**. OBS log shows the new source added with no `[pipewire] Screencast session created` following it, so the source stays inert (no frames). A *saved* source auto-restores its portal session on OBS load; a freshly socket-created one does not prompt.
  - **Implication for AxiStream:** you cannot fully provision a new Wayland screen-capture source purely over the socket. Viable models: (a) ship/seed a pre-configured scene collection and let OBS auto-restore on load, (b) drive the user once through the portal (capture + persist the restore token), then reuse the token, or (c) find an activation request that forces the portal. **Not a blocker — a design constraint.** Needs follow-up to pick the mechanism.

## Task 2b — Wayland portal persistence (Linux: YES)
- KDE's portal dialog offers a "Remember" option; approving with it stores a restore token. Confirmed the user's existing `Guild Wars 2 - Pipewire` source **auto-restores and renders with no prompt** on a fresh OBS instance. This is the foundation for a one-time-approval UX in the real app.

## Task 3 — non-black frames (Linux: PASS)
- Proven via `GetSourceScreenshot` against the user's existing, already-approved GW2 PipeWire capture: returned a **277,930-byte non-black PNG**, visually confirmed to show the live captured screen. This establishes: the obs-websocket screenshot path works, and Wayland/PipeWire capture renders real frames through the sidecar.
- The fresh-source path (Task 2 caveat) is the only gap; the *capture + readback pipeline itself* is sound.

## Process/isolation findings (important for the real app and for spiking safely)
- **The spike was initially driving the user's live OBS scene collection** (their real GW2 streaming setup: `GW2 - Zergling`, `GW2 - Commanding`, `Guild Wars 2 - Pipewire`, `DEFI - Chat Blocker` mask). Now isolated: probes create/switch to a throwaway **`AxiStreamSpike`** scene collection and restore the user's collection (`Untitled`) on exit (`spike/session.js`). **obs-websocket cannot delete a scene collection**, so `AxiStreamSpike` persists empty — harmless.
- **Architecture decision surfaced:** because real users (like this one) already run OBS, AxiStream must decide between driving a *bundled/isolated* OBS (own config, never touches user scenes) vs the *user's* OBS (reuses setup, risks collisions). Recommend bundled+isolated for v1 predictability.
- **Interrupted runs leave OBS on the spike collection** and can orphan OBS — the real sidecar manager needs robust restore-on-crash and `flatpak kill` teardown.
- OBS can report **"not ready"** during startup/collection-switch; all control must retry through that window.

## Open risks still to validate
- **Fresh-source portal trigger over the socket** (Task 2 caveat) — pick the provisioning mechanism (seeded collection / token reuse / activation request).
- Encoder control depth — profile-based vs over-socket. (Task 4)
- End-to-end RTMPS to YouTube. (Task 5)
- Hidden operation: `--minimize-to-tray` behavior / whether OBS stays out of the way. (deferred; capture tests now run with a visible window via `SPIKE_OBS_HIDDEN` opt-in)
- The entire Windows half (needs a Windows machine/VM).
