# Windows CI Smoke Harness — Design

**Date:** 2026-07-08
**Status:** Approved ("yes" to the CI-smoke-first plan).
**Scope:** A `--smoke` boot mode in the app plus a `smoke-windows` CI job
that proves the Windows runtime path — WindowsObsLauncher → obs-websocket
handshake → provisioning → phase reaches a ready state — on every push/PR.
This closes bring-up item 1 of `2026-07-07-windows-compat-analysis.md` to
the extent possible without real hardware (no GPU/audio-device/game
assertions; fail-soft paths count as success where the runner lacks the
hardware).

## `--smoke` mode (app main)

- `process.argv` contains `--smoke` → smoke mode. Before `app.whenReady`:
  `app.disableHardwareAcceleration()` (runners may lack GL; software
  rendering is fine for a boot test).
- A pure watcher (`packages/app/src/main/smoke.ts`):

```ts
export interface SmokeResult { code: 0 | 1; summary: string }
export function createSmokeWatcher(onDone: (r: SmokeResult) => void, timeoutMs = 180000): { observe(phase: string, error: string | null): void; dispose(): void }
```

  - `observe` is called with every state push. First terminal outcome wins:
    - phase ∈ {`READY`, `NEEDS_KEY`, `NEEDS_TITLE`} → `{ code: 0, summary: 'SMOKE OK phase=<p>' }` (a fresh runner has no stream key, so `NEEDS_KEY` is the expected success).
    - phase `ERROR` → `{ code: 1, summary: 'SMOKE FAIL phase=ERROR error=<error>' }`.
    - timeout → `{ code: 1, summary: 'SMOKE FAIL timeout after <t>ms lastPhase=<p>' }` (tracks the last phase seen).
  - `dispose` clears the timer; onDone fires at most once.
- Main wiring: in smoke mode, construct the watcher; every `setState` call
  feeds it (hook inside the existing `setState` helper — one line); on
  `onDone`: `console.log(summary)` then best-effort sidecar/OBS shutdown
  (same as quit path) and `app.exit(code)`.
- Every phase transition also logs `[smoke] phase=<p> error=<e>` to stdout
  so a CI failure log shows the boot progression.

## CI job (`.github/workflows/ci.yml`)

New `smoke-windows` job (parallel to `check`):

- `windows-latest`; checkout, node 22 + npm cache, `npm ci`.
- `choco install obs-studio -y --no-progress` (installs to Program Files —
  exactly what `resolveWindowsObsExe` probes).
- `npm run build` then `npx electron packages/app --smoke` with a
  10-minute step timeout, `shell: bash`.
- On failure: upload OBS + app logs (`%APPDATA%/obs-studio/logs`, stdout is
  already in the step log) as an artifact.

## Expectations / accepted unknowns (iterate in the PR loop)

- OBS video init on a GPU-less runner (D3D11/WARP) may fail → OBS exits →
  app phase ERROR → smoke fails. If so, iterate: OBS `--portable` config,
  or relax the success criterion to "websocket handshake completed" with a
  documented reason. First run tells us.
- WASAPI sources on a runner with no audio devices: OBS-side calls are
  best-effort by project convention (`console.warn`, never throw) — must
  not block the ready phase.
- The runner session is non-interactive; Electron + OBS both run as
  processes fine, but nothing visual is asserted.

## Testing

- `createSmokeWatcher` unit tests (fake timers): ready-phase → code 0 once;
  ERROR → code 1 with the error in the summary; timeout → code 1 with last
  phase; observations after settle ignored; dispose cancels the timer.
- The CI job itself is the integration test — it must go green on the PR
  before merge.

## Not in scope

- PTT/MumbleLink/NVENC Windows backends (next items in the bring-up plan).
- Real capture/audio/encoder assertions (need hardware).
- macOS smoke (no mac OBS launcher exists yet — smoke would fail by design).
