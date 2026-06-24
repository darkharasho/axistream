# Headless Hidden OBS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch AxiStream's OBS sidecar invisibly on Linux inside a headless wlroots compositor (`cage`), so the user never sees an OBS window while capture/streaming/idle-preview keep working.

**Architecture:** Add a `HeadlessCageObsLauncher` to `@axistream/capture` that implements the existing `ObsLauncher` interface by wrapping the OBS command in `WLR_BACKENDS=headless cage -- flatpak run …`, delegating to a fallback (visible) launcher when `cage` is absent. The app selects it on Linux. Nothing else in the pipeline changes.

**Tech Stack:** Node + TypeScript, `cage` (system wlroots compositor), Electron (app wiring), Vitest.

## Global Constraints

- **Linux-only** headless launch; non-Linux platforms keep their existing (visible) launcher.
- **Drop-in `ObsLauncher`:** must implement the existing `interface ObsLauncher { launch(args: string[]): ObsLaunchHandle; killApp(): void }` so `ObsSidecar` consumes it unchanged.
- **Headless env (exact):** `WLR_BACKENDS=headless`, `WLR_HEADLESS_OUTPUTS=1`, `WLR_LIBINPUT_NO_DEVICES=1`.
- **Cage command shape (exact):** `cage -- flatpak run com.obsproject.Studio <obs-args>` (the same `<obs-args>` the visible launcher receives).
- **Fallback, never fail hard:** `cage` absent → delegate to the wrapped visible launcher.
- **`killApp()` delegates to the fallback** (`flatpak kill com.obsproject.Studio` works regardless of how OBS was launched); `ObsSidecar.stop()` already also calls the handle's `kill()`, which kills the spawned `cage` child.
- **Vitest** with the forks-pool 2-worker cap (`npx vitest run <path>`, never `--maxWorkers=2`).
- ESM TypeScript, `.js` import extensions.
- **Scoping decision (from the spec's open item):** the launcher-level fallback covers the realistic failure (cage missing). The rarer "cage present but headless backend never opens the port" case is NOT given an automatic visible-retry here (it would require reconstructing the whole engine graph in `index.ts` for a rare case); it surfaces as the existing `ERROR` phase with the user's Retry path. Documented, intentional.

---

## File Structure

- `packages/capture/src/headless-cage-launcher.ts` — `HeadlessCageObsLauncher` + `cageOnPath()` helper.
- `packages/capture/src/index.ts` — add barrel export.
- `packages/capture/test/headless-cage-launcher.test.ts` — unit tests (mocked spawn + cage detection).
- `packages/capture/test/integration/headless-launch.itest.ts` — real-OBS headless launch (local).
- `packages/app/src/main/index.ts` — select the headless launcher on Linux.
- `packages/app/docs/app-testing.md` — note the headless behavior + `AXISTREAM_OBS_VISIBLE` toggle.

---

### Task 1: `HeadlessCageObsLauncher` (capture library)

**Files:**
- Create: `packages/capture/src/headless-cage-launcher.ts`
- Modify: `packages/capture/src/index.ts`
- Test: `packages/capture/test/headless-cage-launcher.test.ts`

**Interfaces:**
- Consumes: `ObsLauncher`, `ObsLaunchHandle` from `./obs-launcher.js`.
- Produces:
  - `function cageOnPath(): boolean`
  - `interface HeadlessCageOptions { isCageAvailable?: () => boolean; spawnProcess?: (cmd: string, args: string[], env: NodeJS.ProcessEnv) => ObsLaunchHandle }`
  - `class HeadlessCageObsLauncher implements ObsLauncher { constructor(fallback: ObsLauncher, opts?: HeadlessCageOptions); launch(args: string[]): ObsLaunchHandle; killApp(): void }`
  - Behavior: cage available → spawn `cage` with `--`, `flatpak`, `run`, `com.obsproject.Studio`, …args and the headless env; cage absent → `fallback.launch(args)`; `killApp()` → `fallback.killApp()`.

- [ ] **Step 1: Write the failing test `packages/capture/test/headless-cage-launcher.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { HeadlessCageObsLauncher } from '../src/headless-cage-launcher.js'

function fakeLauncher() {
  const handle = { kill: vi.fn(), onExit: vi.fn() }
  return { launch: vi.fn(() => handle), killApp: vi.fn(), handle }
}

describe('HeadlessCageObsLauncher', () => {
  it('wraps OBS in cage with the headless env when cage is available', () => {
    const fallback = fakeLauncher()
    let captured: any
    const spawnProcess = vi.fn((cmd: string, args: string[], env: NodeJS.ProcessEnv) => {
      captured = { cmd, args, env }
      return { kill: vi.fn(), onExit: vi.fn() }
    })
    const l = new HeadlessCageObsLauncher(fallback as any, { isCageAvailable: () => true, spawnProcess })
    l.launch(['--websocket_port', '4455', '--collection', 'AxiStream'])
    expect(captured.cmd).toBe('cage')
    expect(captured.args).toEqual(['--', 'flatpak', 'run', 'com.obsproject.Studio', '--websocket_port', '4455', '--collection', 'AxiStream'])
    expect(captured.env.WLR_BACKENDS).toBe('headless')
    expect(captured.env.WLR_HEADLESS_OUTPUTS).toBe('1')
    expect(captured.env.WLR_LIBINPUT_NO_DEVICES).toBe('1')
    expect(fallback.launch).not.toHaveBeenCalled()
  })

  it('delegates launch to the fallback when cage is unavailable', () => {
    const fallback = fakeLauncher()
    const spawnProcess = vi.fn()
    const l = new HeadlessCageObsLauncher(fallback as any, { isCageAvailable: () => false, spawnProcess })
    const h = l.launch(['--websocket_port', '4455'])
    expect(fallback.launch).toHaveBeenCalledWith(['--websocket_port', '4455'])
    expect(spawnProcess).not.toHaveBeenCalled()
    expect(h).toBe(fallback.handle)
  })

  it('killApp delegates to the fallback (flatpak kill)', () => {
    const fallback = fakeLauncher()
    const l = new HeadlessCageObsLauncher(fallback as any, { isCageAvailable: () => true })
    l.killApp()
    expect(fallback.killApp).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/capture && npx vitest run test/headless-cage-launcher.test.ts`
Expected: FAIL — cannot resolve `../src/headless-cage-launcher.js`.

- [ ] **Step 3: Implement `packages/capture/src/headless-cage-launcher.ts`**

```ts
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ObsLauncher, ObsLaunchHandle } from './obs-launcher.js'

const APP_ID = 'com.obsproject.Studio'
const HEADLESS_ENV = {
  WLR_BACKENDS: 'headless',
  WLR_HEADLESS_OUTPUTS: '1',
  WLR_LIBINPUT_NO_DEVICES: '1',
}

// True if a `cage` executable is on PATH.
export function cageOnPath(): boolean {
  const dirs = (process.env.PATH ?? '').split(':').filter(Boolean)
  return dirs.some((d) => {
    try { return existsSync(join(d, 'cage')) } catch { return false }
  })
}

export interface HeadlessCageOptions {
  isCageAvailable?: () => boolean
  spawnProcess?: (cmd: string, args: string[], env: NodeJS.ProcessEnv) => ObsLaunchHandle
}

function defaultSpawn(cmd: string, args: string[], env: NodeJS.ProcessEnv): ObsLaunchHandle {
  const proc = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stdout.on('data', (d) => process.stdout.write(`[obs] ${d}`))
  proc.stderr.on('data', (d) => process.stderr.write(`[obs] ${d}`))
  return {
    kill: () => { try { proc.kill() } catch { /* ignore */ } },
    onExit: (cb) => proc.on('exit', cb),
  }
}

// Launches OBS invisibly inside a headless wlroots compositor (cage), so it
// renders (capture + streaming + idle preview all keep working) without ever
// showing a window. Falls back to the wrapped (visible) launcher when cage is
// not available. killApp delegates to the fallback — `flatpak kill` ends OBS
// regardless of how it was launched; ObsSidecar.stop() additionally kills the
// spawned cage child via the returned handle.
export class HeadlessCageObsLauncher implements ObsLauncher {
  constructor(
    private readonly fallback: ObsLauncher,
    private readonly opts: HeadlessCageOptions = {},
  ) {}

  launch(args: string[]): ObsLaunchHandle {
    const available = (this.opts.isCageAvailable ?? cageOnPath)()
    if (!available) return this.fallback.launch(args)
    const env = { ...process.env, ...HEADLESS_ENV }
    const cageArgs = ['--', 'flatpak', 'run', APP_ID, ...args]
    return (this.opts.spawnProcess ?? defaultSpawn)('cage', cageArgs, env)
  }

  killApp(): void {
    this.fallback.killApp()
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/capture && npx vitest run test/headless-cage-launcher.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the barrel export to `packages/capture/src/index.ts`**

Add this line alongside the existing exports:
```ts
export * from './headless-cage-launcher.js'
```

- [ ] **Step 6: Run the full capture suite + build to confirm no regressions**

Run: `cd packages/capture && npx vitest run`
Expected: all pass (was 22; now 25 with the 3 new tests).

- [ ] **Step 7: Commit**

```bash
git add packages/capture/src/headless-cage-launcher.ts packages/capture/src/index.ts packages/capture/test/headless-cage-launcher.test.ts
git commit -m "feat: HeadlessCageObsLauncher (invisible OBS via headless cage)"
```

---

### Task 2: App selects headless launcher on Linux + real-OBS integration test

**Files:**
- Modify: `packages/app/src/main/index.ts`
- Create: `packages/capture/test/integration/headless-launch.itest.ts`
- Modify: `packages/app/docs/app-testing.md`

**Interfaces:**
- Consumes: `HeadlessCageObsLauncher`, `FlatpakObsLauncher`, `ObsSidecar` from `@axistream/capture`.
- Produces: the app launches OBS headless on Linux (unless `AXISTREAM_OBS_VISIBLE` is set); a local integration test that boots real headless OBS and tears down cleanly.

- [ ] **Step 1: Modify the launcher construction in `packages/app/src/main/index.ts`**

Add `HeadlessCageObsLauncher` to the existing `@axistream/capture` import:
```ts
import { ObsSidecar, Provisioner, FlatpakObsLauncher, HeadlessCageObsLauncher, CaptureConfig } from '@axistream/capture'
```

Replace the existing sidecar-launcher construction line:
```ts
const sidecar = new ObsSidecar({ launcher: new FlatpakObsLauncher(), collection: 'AxiStream' })
```
with launcher selection:
```ts
const visibleLauncher = new FlatpakObsLauncher()
const useHeadless = process.platform === 'linux' && !process.env.AXISTREAM_OBS_VISIBLE
const launcher = useHeadless ? new HeadlessCageObsLauncher(visibleLauncher) : visibleLauncher
const sidecar = new ObsSidecar({ launcher, collection: 'AxiStream' })
```

- [ ] **Step 2: Verify the app builds + unit suite unaffected**

Run: `cd packages/app && npm run build`
Expected: `electron-vite build` clean (confirms `HeadlessCageObsLauncher` is exported and the wiring typechecks).
Run: `cd packages/app && npx vitest run`
Expected: 26 passed (unchanged — this is a main-process wiring change with no unit test, covered by the integration test below).

- [ ] **Step 3: Write the real-OBS integration test `packages/capture/test/integration/headless-launch.itest.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { ObsSidecar } from '../../src/obs-sidecar.js'
import { FlatpakObsLauncher } from '../../src/obs-launcher.js'
import { HeadlessCageObsLauncher } from '../../src/headless-cage-launcher.js'

// Integration: requires real OBS + `cage`. Launches OBS HEADLESS (no visible
// window) and confirms it is controllable and tears down cleanly. Run with:
//   npx vitest run --config vitest.integration.config.ts test/integration/headless-launch.itest.ts
describe('Headless cage launch (integration, real OBS + cage)', () => {
  let sidecar: ObsSidecar
  afterEach(async () => { await sidecar?.stop() })

  it('launches OBS headless, GetVersion works, no orphan after teardown', async () => {
    sidecar = new ObsSidecar({
      launcher: new HeadlessCageObsLauncher(new FlatpakObsLauncher()),
      collection: 'AxiStream',
    })
    await sidecar.start()
    const ver = await sidecar.client().call('GetVersion')
    expect(ver.obsVersion).toBeTruthy()
  }, 60000)
})
```

- [ ] **Step 4: Run the integration test (real OBS + cage required, local)**

Run: `cd packages/capture && npx vitest run --config vitest.integration.config.ts test/integration/headless-launch.itest.ts`
Expected: PASS — OBS boots inside headless cage, `GetVersion` returns, **no OBS window appears**, and after teardown no `com.obsproject.Studio` process remains (verify: `flatpak ps | grep -i obs` is empty; `flatpak kill com.obsproject.Studio` as a safety net). If `cage` is not installed, the launcher falls back to visible — note that in the report.

- [ ] **Step 5: Document the behavior in `packages/app/docs/app-testing.md`**

Append:
```markdown
## OBS visibility (Linux)
On Linux the app launches OBS **headless** (invisible) inside `cage`
(`WLR_BACKENDS=headless`). Set `AXISTREAM_OBS_VISIBLE=1` to force a visible OBS
window for debugging. If `cage` is not installed, the app automatically falls
back to a visible OBS window.

### Manual first-run check (headless capture)
Launch the app (`npm -w @axistream/app run dev`), click "Set up capture",
approve the screen-share dialog (it appears on your real screen even though OBS
is headless), and confirm: the live preview thumbnail renders the real screen
while OBS has no visible window, and streaming works.
```

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/main/index.ts packages/capture/test/integration/headless-launch.itest.ts packages/app/docs/app-testing.md
git commit -m "feat: app launches OBS headless on Linux + integration test + docs"
```

---

## Self-Review

**Spec coverage:**
- `HeadlessCageObsLauncher` (cage headless wrap, env, command shape) → Task 1.
- cage-detection + visible fallback → Task 1 (`cageOnPath` / `isCageAvailable`, delegate to fallback).
- `killApp` delegates to fallback → Task 1.
- App selects headless on Linux + `AXISTREAM_OBS_VISIBLE` hatch → Task 2.
- Drop-in `ObsLauncher` (pipeline unchanged) → Task 1 implements the exact interface; Task 2 only swaps the launcher instance.
- Idle-preview payoff → inherent (headless cage renders continuously); validated by Task 2's manual first-run note.
- Testing: unit (mocked spawn/detection) → Task 1; integration (real headless) + manual → Task 2.
- The "port never opens" auto-retry is intentionally **not** built (Global Constraints scoping decision); the realistic cage-absent case is covered by the launcher fallback.

**Placeholder scan:** No TBD/echo placeholders; every code step carries complete code.

**Type consistency:** `HeadlessCageObsLauncher`, `HeadlessCageOptions`, `cageOnPath`, `ObsLauncher`/`ObsLaunchHandle`, the headless env keys, and the `cage -- flatpak run com.obsproject.Studio …args` command shape are used consistently across Task 1 (definition/tests) and Task 2 (app wiring/integration test). `killApp` delegates to the fallback, consistent with `ObsSidecar.stop()` also calling the handle's `kill()` (defined in the existing `ObsSidecar`).
