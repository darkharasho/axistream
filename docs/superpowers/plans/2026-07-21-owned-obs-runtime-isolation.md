# Owned OBS Runtime Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Make AxiStream capture use only a verified AxiStream-owned OBS runtime on Windows and Linux, select a real Windows monitor, and surface every setup failure without touching personal OBS.

**Architecture:** App main prepares a platform-specific `OwnedObsRuntime` before it constructs `ObsSidecar`. Launchers receive validated, explicit runtime identities and may stop only their own tracked process or dedicated Flatpak app ID. Capture configuration is engine-scoped schema v2. Provisioning is split into target discovery and target application, with shared state/IPC driving progress, selection, retry, and errors.

**Tech Stack:** TypeScript, Electron, React, OBS WebSocket 5, Flatpak, Windows Job Objects through Koffi, Vitest, electron-builder, GitHub Actions.

---

## Task 1: Invalidate unsafe legacy capture state

**Files:**
- Modify: `packages/capture/src/capture-config.ts`
- Modify: `packages/capture/test/capture-config.test.ts`

1. Add failing tests proving missing/v1/wrong-engine configs are unprovisioned and schema-2 matching-engine configs round-trip.
2. Run `npm test -w packages/capture -- capture-config.test.ts` and confirm the new cases fail.
3. Add `CAPTURE_CONFIG_SCHEMA = 2`, `engineId`, and opaque `{ property, value, label }` target fields. Require the expected engine ID in `CaptureConfig` and validate every field on load.
4. Re-run the focused test and commit `feat(capture): scope provisioning state to owned engine`.

## Task 2: Replace the Windows personal-OBS launcher

**Files:**
- Add: `packages/capture/src/owned-obs-runtime.ts`
- Add: `packages/capture/src/windows-owned-obs-runtime.ts`
- Add: `packages/capture/test/windows-owned-obs-runtime.test.ts`
- Replace: `packages/capture/src/windows-obs-launcher.ts`
- Replace: `packages/capture/test/windows-obs-launcher.test.ts`
- Modify: `packages/capture/src/index.ts`
- Modify: `packages/capture/package.json`

1. Write failing runtime tests for manifest hash validation, valid marker reuse, traversal/absolute/symlink archive rejection, interrupted staging cleanup, and repair preserving only owned `config`.
2. Write failing launcher tests proving the executable and websocket config paths are constructor-supplied private paths, required portable flags are present, containment failure kills only the spawned child, and no broad process kill exists.
3. Run both focused tests and capture the expected failures.
4. Implement `OwnedObsRuntime`, an injectable safe archive extractor using `extract-zip`, a version/hash/entrypoint ownership marker, staging plus atomic rename, and fail-closed validation.
5. Implement `WindowsObsLauncher` around an explicit private executable/config root. Write websocket settings only beneath that root. Add a `WindowsProcessContainer` abstraction and Koffi-backed Job Object implementation with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; track and stop only its own handle.
6. Remove installed-OBS resolution, `APPDATA` access, and image-wide `taskkill`.
7. Re-run focused tests and commit `feat(capture): launch verified portable OBS on Windows`.

## Task 3: Make sidecar lifecycle ownership-safe

**Files:**
- Modify: `packages/capture/src/obs-launcher.ts`
- Modify: `packages/capture/src/obs-sidecar.ts`
- Modify: `packages/capture/test/obs-sidecar.test.ts`

1. Add failing tests proving startup has no global orphan cleanup, the OBS 32 flags include `--portable --disable-updater --disable-missing-files-check --multi`, the obsolete shutdown flag is absent, and stop targets only the current launch handle/owned launcher.
2. Replace `killApp()` with `stopOwned()` and make sidecar failure cleanup bounded to the just-created owned handle.
3. Run `npm test -w packages/capture -- obs-sidecar.test.ts` and commit `fix(capture): contain sidecar lifecycle to owned OBS`.

## Task 4: Implement real Windows monitor selection

**Files:**
- Modify: `packages/capture/src/provisioner.ts`
- Modify: `packages/capture/test/provisioner.test.ts`
- Modify: `packages/capture/src/capture-config.ts`

1. Add failing tests for modern `monitor_id`, legacy `monitor`, disabled placeholder filtering, zero/one/multiple targets, opaque value preservation, selection application, cancellation, and frame timeout.
2. Add `CaptureTargetOption` and a two-stage result: `targets` when a choice is needed, or `ready` after selection/frame verification. Query `GetInputPropertiesListPropertyItems`, apply `SetInputSettings`, and persist schema-2 target only after a non-black frame.
3. Keep Linux portal provisioning behavior unchanged except for engine-scoped config.
4. Run the focused suite and commit `feat(capture): select and verify Windows monitor`.

## Task 5: Prepare runtime before capture and expose truthful IPC state

**Files:**
- Modify: `packages/app/src/main/CaptureService.ts`
- Modify: `packages/app/test/capture-service.test.ts`
- Modify: `packages/app/src/shared/state.ts`
- Modify: `packages/app/src/main/ipc.ts`
- Modify: `packages/app/src/preload/index.ts`
- Modify: `packages/app/test/ipc-contract.test.ts`
- Modify: `packages/app/src/main/index.ts`

1. Add failing tests for `PREPARING_CAPTURE`, `CHOOSING_CAPTURE`, target payload transport, cancellation, duplicate-action rejection, and stable visible errors from runtime/launch/target/frame failures.
2. Change boot so it prepares `OwnedObsRuntime` first, constructs `ObsSidecar` only from the returned launch spec, and never calls profile/config helpers against another OBS identity.
3. Remove `hideObsTray()` and the boot-time installed-OBS/personal-Flatpak constructors. Catch all capture action errors in `CaptureService`, stop an unreliable owned sidecar, and push `{ phase: 'ERROR', error }`.
4. Add `listCaptureTargets`, selection-bearing `provision`, and `cancelCaptureSelection` IPC/preload APIs; prevent concurrent setup with one in-flight promise.
5. Run app service/IPC tests and commit `feat(app): expose owned capture setup lifecycle`.

## Task 6: Render progress, chooser, error, cancellation, and retry

**Files:**
- Modify: `packages/app/src/renderer/components/StreamScreen.tsx`
- Modify: `packages/app/src/renderer/styles.css`
- Modify: `packages/app/test/stream-screen.test.tsx`

1. Add failing tests that the CTA becomes busy immediately, duplicate clicks are ignored, monitor options render during `CHOOSING_CAPTURE`, selection/cancel payloads are sent, and rejected calls display the main-process error with Retry Setup.
2. Implement local pending state plus phase-driven progress labels, accessible monitor chooser controls, cancel, and retry.
3. Run the focused renderer suite and commit `feat(ui): make capture setup observable and selectable`.

## Task 7: Own the Linux Flatpak identity

**Files:**
- Add: `packages/capture/src/linux-owned-obs-runtime.ts`
- Add: `packages/capture/test/linux-owned-obs-runtime.test.ts`
- Modify: `packages/capture/src/obs-launcher.ts`
- Modify: `packages/capture/src/headless-cage-launcher.ts`
- Modify: `packages/capture/test/headless-cage-launcher.test.ts`
- Modify: `packages/app/src/main/index.ts`

1. Add failing tests for exact `link.axi.AxiStream.OBS` install/verification/launch/kill commands, injected app IDs in visible/headless launchers, origin/branch/commit rejection, and no standard-ID fallback.
2. Implement `LinuxOwnedObsRuntime` to install the packaged per-user bundle non-interactively, inspect exact app ID/origin/branch/commit, and return only the dedicated launcher.
3. Inject owned app ID into both Linux launchers and remove hardcoded `com.obsproject.Studio` behavior.
4. Run focused tests and commit `feat(capture): isolate Linux OBS Flatpak identity`.

## Task 8: Pin and package redistributable runtimes

**Files:**
- Add: `resources/obs-runtime/manifest.json`
- Add: `scripts/prepare-obs-runtime.mjs`
- Add: `scripts/test-obs-isolation.mjs`
- Add: `docs/obs-recovery.md`
- Add: `docs/obs-redistribution.md`
- Modify: `package.json`
- Modify: `packages/app/electron-builder.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.gitignore`

1. Add a failing manifest/script test that requires pinned version/URLs/SHA-256/entrypoints, forbids moving URLs and prohibited personal-OBS operations, and verifies platform assets before packaging.
2. Add the OBS 32.1.2 Windows archive pin and Linux dedicated-bundle metadata. Implement cached download/hash verification and platform staging; packaging must fail when its selected platform asset is absent.
3. Stage assets through `extraResources`, publish notices/source information, replace Chocolatey/standard-Flatpak smoke setup with owned assets, and create personal-OBS sentinel hashes before/after smoke.
4. Document manual recovery without changing personal OBS automatically.
5. Run the static isolation gate and commit `build: package pinned owned OBS runtimes`.

## Task 9: Prove the change

**Files:**
- Add evidence: `docs/verification/2026-07-21-owned-obs-runtime.md`

1. Run focused tests after each red/green cycle, then `npm test`.
2. Run `npm run build --workspaces --if-present` and the static isolation script.
3. Build the host Linux package using a locally prepared dedicated bundle; record exact commands and results.
4. Run available automated Windows/Linux smoke coverage. Record Windows real-hardware and Linux portal/manual checks as required external acceptance, never as passed without actual hardware evidence.
5. Review `git diff --check`, `git status --short`, and the complete diff for forbidden personal OBS paths.
6. Commit `test: verify owned OBS runtime isolation`.
