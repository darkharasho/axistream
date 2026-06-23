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
| 04 encoder control   | PASS (profile encoder used by stream) | not run |
| 05 RTMPS live        | **PASS** (live on YouTube, 0 dropped frames) | not run |

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

## Task 5 — end-to-end RTMPS to YouTube (Linux: PASS)
- Set the stream service to `rtmp_custom` / `rtmps://a.rtmps.youtube.com/live2` + key entirely over the socket, switched program scene to the user's `GW2 - Zergling`, `StartStream`, streamed ~20s, `StopStream` — all via obs-websocket.
- Result: `outputActive: true`, `outputReconnecting: false`, **0 skipped frames / 436 total**, `outputBytes` climbed 0 → ~9.8 MB. User visually confirmed the stream live on YouTube.
- **RTMPS (TLS) ingest works** — no fallback to plain RTMP needed.
- Encoder (Task 4) implicitly validated: the stream used the OBS **profile's** configured encoder. Confirms the design that AxiStream applies GW2 presets via OBS profiles/settings, then streams.
- Probe is non-destructive: saved + restored the user's original stream service settings and program scene afterward. The key is read from a gitignored `.env` and never logged or returned.

## VERDICT (Linux half): **GO**
Every hard gate and the end-to-end stream pass on Bazzite/Wayland. The OBS-sidecar-over-obs-websocket approach is viable as AxiStream's capture/encode/stream foundation on Linux. Remaining items are scoped design work and the Windows validation, not viability unknowns.

### Carry-forward design constraints (not blockers)
1. **Fresh Wayland capture source provisioning:** `CreateInput` alone doesn't trigger the portal. Provision via a seeded collection or a one-time portal approval + restore-token reuse.
2. **Isolation/lifecycle:** bundle an isolated OBS config; robust teardown is `flatpak kill` (Linux); restore-on-crash needed; retry through OBS "not ready".
3. **Encoder presets:** apply via OBS profiles, not ad-hoc socket settings.
4. **Hidden operation** still to be validated (capture ran with a visible window).

## Provisioning mechanism (RESOLVED — probes 07, 08)
The Task 2 caveat is now fully characterized and solved:
- **Runtime `CreateInput` capture sources never initialize on Wayland** — even with the real `RestoreToken` injected (probe 07: `Failed to render screenshot`). The token alone is not enough.
- **A socket-built source that is persisted and RELOADED renders correctly** (probe 08): build the scene/source over obs-websocket → switch scene collections (forces OBS to save) → relaunch OBS with `--collection <name>` → the now config-loaded source initializes, prompts the portal once, and renders (274 KB non-black frame, visually confirmed; user approved + remembered).
- **Provisioning model for AxiStream:** build the scene collection over the socket (no fragile hand-authoring of OBS config JSON), persist it, then (re)launch OBS pointed at that collection. First launch triggers a one-time portal approval; the restore token then persists for silent re-launches. `--collection <name>` selects which collection OBS loads.

## Open risks still to validate
- **Fresh-source portal trigger over the socket** (Task 2 caveat) — pick the provisioning mechanism (seeded collection / token reuse / activation request).
- Encoder control depth — profile-based vs over-socket. (Task 4)
- End-to-end RTMPS to YouTube. (Task 5)
- Hidden operation: `--minimize-to-tray` behavior / whether OBS stays out of the way. (deferred; capture tests now run with a visible window via `SPIKE_OBS_HIDDEN` opt-in)
- The entire Windows half (needs a Windows machine/VM).
