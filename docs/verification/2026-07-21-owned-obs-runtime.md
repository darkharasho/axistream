# Owned OBS runtime verification — 2026-07-21

## Automated verification

- `@axistream/app`: 50 test files, 412 tests passed.
- `@axistream/capture`: 21 test files, 119 tests passed.
- TypeScript checks passed for both workspaces.
- All workspace builds passed.
- GitHub Actions workflows passed `actionlint` 1.7.7 and YAML parsing.
- Runtime manifests and the Flatpak recipe passed JSON parsing.
- The Windows OBS 32.1.2 archive matched SHA-256 `8d97e4563bd8d22d03e63042aa7dccede1d555c9bd35ce8a9e5019b0d0201bf6`.
- The Linux AxiStream OBS bundle matched SHA-256 `ff3f6576c1eab8e5d88f529804326821f7ae663c00ba5c49bd1412646787c517`.

## Linux packaged smoke

The packaged `AxiStream-0.1.11-x86_64.AppImage` completed `--smoke-runtime` successfully. The smoke test installed and launched only the dedicated Flatpak application, authenticated to obs-websocket, and received OBS version 32.1.2.

Verified runtime identity:

- app ID: `link.axi.AxiStream.OBS`
- ref: `app/link.axi.AxiStream.OBS/x86_64/stable`
- commit: `02ef3690810c69752e84c39f1b35fd0950d1b1e94513774f51f0a64c37821340`
- origin: `obs-origin`

The runtime log confirmed that `linux-pipewire-audio.so` and `obs-composite-blur.so` loaded. Recursive hashes of the standard `~/.var/app/com.obsproject.Studio` configuration tree were identical before and after the development and packaged smoke runs. No owned OBS process remained after teardown.

## Windows coverage

Unit and integration tests cover portable extraction, archive traversal rejection, install verification, private configuration, Job Object containment, monitor enumeration/selection, frame verification, and refusal to discover or stop a personal OBS process. The Windows GitHub Actions smoke job additionally seeds and hashes a personal OBS profile (including resolution, YouTube service metadata, and scene collection), starts an unrelated `obs64.exe` process, runs the owned sidecar, and verifies both remain untouched.

A real Windows runner was not available in this Linux development environment, so the Windows workflow and manual physical-monitor acceptance remain the platform-specific release gates.

## Post-merge review follow-ups

A five-dimension parallel code review ran after merge. Fixes applied:

- **Stale capture target no longer loops.** A persisted target (e.g. an unplugged
  monitor) that is gone now clears itself and falls back to auto-select/chooser
  instead of throwing an error the Retry button could never escape.
- **Windows OBS hash single-sourced.** App main reads `resources/obs-runtime/manifest.json`
  (fail-closed to an all-zero hash) rather than carrying a duplicate literal that
  could drift on a version bump; an isolation-gate test forbids re-duplicating it.
- **Linux owned-orphan cleanup.** `LinuxOwnedObsRuntime.prepare()` kills only the
  dedicated `link.axi.AxiStream.OBS` app id before launch, clearing an instance
  leaked by a prior hard crash without ever touching personal OBS.

Reviewed and accepted without change:

- **Linux `expectedOrigin: obs-origin`** is confirmed by the packaged smoke above
  (a real `flatpak info --show-origin` returned `obs-origin`) and is deterministic
  per bundle; the CI smoke re-verifies it against a live install, so a wrong value
  would fail closed there rather than reach users.
- **Windows Job Object assignment** (`spawn` then `assign`) carries a theoretical
  PID-recycle race; deferred as a low-severity Windows-only follow-up
  (`CREATE_SUSPENDED` → assign → resume), not fixed blind without a Windows runner.
- **New `packages/capture` deps** (`extract-zip`, `koffi`) are validated by the
  release build/`dist` pipeline itself.
