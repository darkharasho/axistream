# Game-Audio Plugin Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings offers an optional, app-handled install of the OBS PipeWire audio-capture flatpak extension, with honest status detection and app-relaunch activation.

**Architecture:** A `PluginInstaller` (main, injected exec) detects/installs the flathub extension; a pure `deriveGameAudioStatus` combines the flatpak state with OBS's `GetInputKindList` probe; state/IPC/preload wiring follows the house pattern; a `GameAudioSettings` component renders per-status UI. Activation is a full app relaunch (silent capture restore), never an in-place OBS bounce. Spec: `docs/superpowers/specs/2026-07-06-game-audio-plugin-install-design.md`.

**Tech Stack:** Electron 31 (`app.relaunch`), Node `child_process.execFile`, React 18, Vitest 2.

## Global Constraints

- No new dependencies.
- Code style: 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on relative imports.
- Exact ref: `com.obsproject.Studio.Plugin.PipeWireAudioCapture`. Exact argv: detect `flatpak info <REF>`; install `flatpak install --user --noninteractive flathub <REF>`, retry `flatpak install --system --noninteractive flathub <REF>`. Install timeout 600000 ms; detect timeout 15000 ms. Error text = last 500 chars of output.
- Statuses (exact union): `'missing' | 'installing' | 'installed' | 'ready' | 'error' | 'unsupported'`.
- Ready-kind regex: `/pipewire.*audio|audio.*pipewire/i`, EXCLUDING the exact kind `pipewire-screen-capture-source`.
- Boot must log `console.info('[game-audio] input kinds', kinds)` — spec-B artifact.
- `relaunchApp` no-ops while `stream.isLive()`. Everything best-effort; nothing blocks boot/go-live.
- Gates per task: `npm -w @axistream/app run test`; final: plus `cd packages/app && npx tsc --noEmit -p tsconfig.json` zero errors.

---

## File Structure

**New:** `packages/app/src/main/PluginInstaller.ts` (installer + pure status derivation), `packages/app/src/renderer/components/GameAudioSettings.tsx`; tests `plugin-installer.test.ts`, `game-audio-settings.test.tsx`.
**Modified:** `src/shared/state.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/renderer/components/SettingsScreen.tsx`; tests `ipc-contract.test.ts`, `settings-screen.test.tsx` (fixture).

---

### Task 1: PluginInstaller + status derivation

**Files:**
- Create: `packages/app/src/main/PluginInstaller.ts`
- Test: `packages/app/test/plugin-installer.test.ts`

**Interfaces:**
- Produces:

```ts
export const PLUGIN_REF = 'com.obsproject.Studio.Plugin.PipeWireAudioCapture'
export type FlatpakState = 'missing' | 'installed' | 'unsupported'
export type GameAudioPluginStatus = 'missing' | 'installing' | 'installed' | 'ready' | 'error' | 'unsupported'
export interface ExecResult { code: number; output: string }
export interface InstallerDeps { exec(cmd: string, args: string[], timeoutMs: number): Promise<ExecResult> }
export class PluginInstaller {
  constructor(d: InstallerDeps)
  detectInstalled(): Promise<FlatpakState>
  install(): Promise<{ ok: boolean; error?: string }>
}
export function deriveGameAudioStatus(flatpak: FlatpakState, kinds: string[]): GameAudioPluginStatus
```

(`GameAudioPluginStatus` lives here first; Task 2 moves it to `shared/state.ts` and this file re-imports + re-exports it — same pattern as `MaskRect`.)

- [ ] **Step 1: Write the failing tests** — `packages/app/test/plugin-installer.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { PluginInstaller, deriveGameAudioStatus, PLUGIN_REF } from '../src/main/PluginInstaller.js'

function fakeExec(script: (cmd: string, args: string[]) => { code: number; output: string } | Error) {
  const calls: { cmd: string; args: string[]; timeoutMs: number }[] = []
  const exec = vi.fn(async (cmd: string, args: string[], timeoutMs: number) => {
    calls.push({ cmd, args, timeoutMs })
    const r = script(cmd, args)
    if (r instanceof Error) throw r
    return r
  })
  return { exec, calls }
}

describe('PluginInstaller.detectInstalled', () => {
  it('exit 0 → installed', async () => {
    const f = fakeExec(() => ({ code: 0, output: 'Ref: ...' }))
    expect(await new PluginInstaller(f).detectInstalled()).toBe('installed')
    expect(f.calls[0]).toEqual({ cmd: 'flatpak', args: ['info', PLUGIN_REF], timeoutMs: 15000 })
  })
  it('nonzero exit → missing', async () => {
    const f = fakeExec(() => ({ code: 1, output: 'error: not installed' }))
    expect(await new PluginInstaller(f).detectInstalled()).toBe('missing')
  })
  it('spawn failure (no flatpak) → unsupported', async () => {
    const f = fakeExec(() => new Error('ENOENT'))
    expect(await new PluginInstaller(f).detectInstalled()).toBe('unsupported')
  })
})

describe('PluginInstaller.install', () => {
  it('user-level success issues the exact argv', async () => {
    const f = fakeExec(() => ({ code: 0, output: 'ok' }))
    expect(await new PluginInstaller(f).install()).toEqual({ ok: true })
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]).toEqual({ cmd: 'flatpak', args: ['install', '--user', '--noninteractive', 'flathub', PLUGIN_REF], timeoutMs: 600000 })
  })
  it('user failure retries system-level once', async () => {
    const f = fakeExec((_c, args) => args.includes('--user') ? { code: 1, output: 'denied' } : { code: 0, output: 'ok' })
    expect(await new PluginInstaller(f).install()).toEqual({ ok: true })
    expect(f.calls).toHaveLength(2)
    expect(f.calls[1].args).toEqual(['install', '--system', '--noninteractive', 'flathub', PLUGIN_REF])
  })
  it('both fail → ok:false with output tail', async () => {
    const f = fakeExec(() => ({ code: 1, output: 'x'.repeat(600) + 'TAIL' }))
    const r = await new PluginInstaller(f).install()
    expect(r.ok).toBe(false)
    expect(r.error).toHaveLength(500)
    expect(r.error!.endsWith('TAIL')).toBe(true)
  })
  it('spawn throw → ok:false, never rejects', async () => {
    const f = fakeExec(() => new Error('ENOENT'))
    await expect(new PluginInstaller(f).install()).resolves.toMatchObject({ ok: false })
  })
})

describe('deriveGameAudioStatus', () => {
  const K = ['monitor_capture', 'pipewire-screen-capture-source', 'pulse_input_capture']
  it('unsupported flatpak → unsupported', () => { expect(deriveGameAudioStatus('unsupported', K)).toBe('unsupported') })
  it('missing → missing', () => { expect(deriveGameAudioStatus('missing', K)).toBe('missing') })
  it('installed but no audio kind → installed', () => { expect(deriveGameAudioStatus('installed', K)).toBe('installed') })
  it('installed + pipewire audio kind → ready', () => {
    expect(deriveGameAudioStatus('installed', [...K, 'pipewire-audio-application-capture'])).toBe('ready')
  })
  it('screen-capture kind alone never counts as ready', () => {
    expect(deriveGameAudioStatus('installed', ['pipewire-screen-capture-source'])).toBe('installed')
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/app run test -- test/plugin-installer.test.ts` → FAIL (module missing)
- [ ] **Step 3: Implement** — `packages/app/src/main/PluginInstaller.ts`:

```ts
export const PLUGIN_REF = 'com.obsproject.Studio.Plugin.PipeWireAudioCapture'

export type FlatpakState = 'missing' | 'installed' | 'unsupported'
// Temporary home; Task 2 moves this to shared/state.ts and this file re-imports it.
export type GameAudioPluginStatus = 'missing' | 'installing' | 'installed' | 'ready' | 'error' | 'unsupported'

export interface ExecResult { code: number; output: string }
export interface InstallerDeps {
  exec(cmd: string, args: string[], timeoutMs: number): Promise<ExecResult>
}

const DETECT_TIMEOUT_MS = 15000
const INSTALL_TIMEOUT_MS = 600000

/** Detects and installs the OBS PipeWire audio-capture flatpak extension.
 *  User-level install first (no password; flatpak resolves extensions across
 *  installations), one system-level retry (polkit dialog). Best-effort:
 *  install() never rejects. */
export class PluginInstaller {
  constructor(private readonly d: InstallerDeps) {}

  async detectInstalled(): Promise<FlatpakState> {
    try {
      const r = await this.d.exec('flatpak', ['info', PLUGIN_REF], DETECT_TIMEOUT_MS)
      return r.code === 0 ? 'installed' : 'missing'
    } catch {
      return 'unsupported' // flatpak binary missing / unspawnable
    }
  }

  async install(): Promise<{ ok: boolean; error?: string }> {
    let last = ''
    for (const scope of ['--user', '--system']) {
      try {
        const r = await this.d.exec('flatpak', ['install', scope, '--noninteractive', 'flathub', PLUGIN_REF], INSTALL_TIMEOUT_MS)
        if (r.code === 0) return { ok: true }
        last = r.output
      } catch (e) {
        last = e instanceof Error ? e.message : String(e)
      }
    }
    return { ok: false, error: last.slice(-500) }
  }
}

/** Combined status: flatpak state (on disk) + OBS input kinds (loaded).
 *  The built-in screen-capture kind must not count as the audio plugin. */
export function deriveGameAudioStatus(flatpak: FlatpakState, kinds: string[]): GameAudioPluginStatus {
  if (flatpak === 'unsupported') return 'unsupported'
  if (flatpak === 'missing') return 'missing'
  const loaded = kinds.some((k) => k !== 'pipewire-screen-capture-source' && /pipewire.*audio|audio.*pipewire/i.test(k))
  return loaded ? 'ready' : 'installed'
}
```

- [ ] **Step 4: Run to verify pass** — same command → 11 passed
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/PluginInstaller.ts packages/app/test/plugin-installer.test.ts
git commit -m "feat(game-audio): plugin installer + status derivation"
```

---

### Task 2: Shared state + IPC + preload

**Files:**
- Modify: `packages/app/src/shared/state.ts`, `packages/app/src/main/PluginInstaller.ts`, `packages/app/src/main/ipc.ts`, `packages/app/src/preload/index.ts`
- Test: `packages/app/test/ipc-contract.test.ts` (append)

**Interfaces:**
- Produces in `shared/state.ts`:

```ts
export type GameAudioPluginStatus = 'missing' | 'installing' | 'installed' | 'ready' | 'error' | 'unsupported'
export interface GameAudioPluginView { status: GameAudioPluginStatus; error: string | null }
// AppState gains:  gameAudioPlugin: GameAudioPluginView    (INITIAL_STATE: { status: 'missing', error: null })
// CH gains:        getGameAudioPluginStatus: 'axi:getGameAudioPluginStatus'
//                  installGameAudioPlugin: 'axi:installGameAudioPlugin'
//                  relaunchApp: 'axi:relaunchApp'
// AxiApi gains:    getGameAudioPluginStatus(): Promise<GameAudioPluginView>
//                  installGameAudioPlugin(): Promise<void>
//                  relaunchApp(): Promise<void>
```

- [ ] **Step 1: Failing test** — in `ipc-contract.test.ts` add `CH.getGameAudioPluginStatus, CH.installGameAudioPlugin, CH.relaunchApp` to `commandChannels` (and `getGameAudioPluginStatus: vi.fn(), installGameAudioPlugin: vi.fn(), relaunchApp: vi.fn()` to the handlers mock, matching its pattern).
- [ ] **Step 2:** `npm -w @axistream/app run test -- test/ipc-contract.test.ts` → FAIL
- [ ] **Step 3: Implement.**
  - `shared/state.ts`: add the type, interface, `AppState.gameAudioPlugin`, `INITIAL_STATE.gameAudioPlugin = { status: 'missing', error: null }`, the three channels, the three `AxiApi` methods.
  - `PluginInstaller.ts`: delete the local `GameAudioPluginStatus`; `import type { GameAudioPluginStatus } from '../shared/state.js'` and re-export it (`export type { GameAudioPluginStatus }`).
  - `ipc.ts`: add to `IpcHandlers` — `getGameAudioPluginStatus(): Promise<GameAudioPluginView>`, `installGameAudioPlugin(): Promise<void>`, `relaunchApp(): Promise<void>` (import `GameAudioPluginView`); register `ipcMain.handle(CH.<each>, () => handlers.<each>())`.
  - `preload/index.ts`: the three `ipcRenderer.invoke` one-liners, mirroring siblings.
- [ ] **Step 4:** `npm -w @axistream/app run test -- test/ipc-contract.test.ts` → pass. Full suite → pass (fixtures spread INITIAL_STATE; add `gameAudioPlugin: { status: 'missing', error: null }` to any hand-built AppState the compiler flags). Typecheck will be red ONLY in `src/main/index.ts` (handlers missing the three methods) until Task 3 — verify and note.
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/main/PluginInstaller.ts packages/app/src/main/ipc.ts packages/app/src/preload/index.ts packages/app/test/ipc-contract.test.ts
git commit -m "feat(state): gameAudioPlugin status + install/relaunch channels"
```

(Include any fixture files touched.)

---

### Task 3: Main wiring

**Files:**
- Modify: `packages/app/src/main/index.ts`
- Test: suites + typecheck (seams tested in Tasks 1–2)

**Interfaces:**
- Consumes: `PluginInstaller`, `deriveGameAudioStatus`, `PLUGIN_REF` (Task 1); channels/handlers (Task 2); existing `stream.isLive()`, `setState`, `sidecar.client()`.

- [ ] **Step 1: Wire it.** In `index.ts`:
  - Imports: `import { execFile } from 'node:child_process'`; `import { PluginInstaller, deriveGameAudioStatus } from './PluginInstaller.js'`.
  - After the `maskCtl` construction:

```ts
  const installer = new PluginInstaller({
    exec: (cmd, args, timeoutMs) => new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        const output = `${stdout ?? ''}${stderr ?? ''}`
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') { reject(err); return }
        // Non-ENOENT failures (nonzero exit, timeout kill) resolve with a nonzero code.
        resolve({ code: err ? ((err as { code?: number }).code as number ?? 1) : 0, output })
      })
    }),
  })
```

Note: `execFile`'s callback `err.code` is the exit code (number) for nonzero exits but a string (`'ENOENT'`) for spawn failures — the ENOENT check above must come first, and the `?? 1` fallback covers timeout kills (where `code` is null).

  - Handlers (next to the audio ones):

```ts
    getGameAudioPluginStatus: async () => state.gameAudioPlugin,
    installGameAudioPlugin: async () => {
      if (state.gameAudioPlugin.status === 'installing') return
      setState({ gameAudioPlugin: { status: 'installing', error: null } })
      const r = await installer.install()
      setState({ gameAudioPlugin: r.ok ? { status: 'installed', error: null } : { status: 'error', error: r.error ?? 'Install failed' } })
    },
    relaunchApp: async () => {
      if (stream.isLive()) return
      app.relaunch()
      app.quit()
    },
```

  - Boot probe (provisioned branch, after the masks re-apply): 

```ts
      const flatpakState = await installer.detectInstalled()
      let kinds: string[] = []
      try { kinds = ((await sidecar.client().call('GetInputKindList')) as { inputKinds?: string[] }).inputKinds ?? [] } catch { /* best-effort */ }
      console.info('[game-audio] input kinds', kinds)
      setState({ gameAudioPlugin: { status: deriveGameAudioStatus(flatpakState, kinds), error: null } })
```

  - Unprovisioned boot (the `else` branch): still detect flatpak state so Settings is truthful pre-capture: `setState({ gameAudioPlugin: { status: deriveGameAudioStatus(await installer.detectInstalled(), []), error: null } })` — note with `[]` kinds this yields `installed` (not `ready`) or `missing`/`unsupported`, which is correct before OBS is probed.

- [ ] **Step 2: Typecheck** — zero errors (Task 2's staged gap closes).
- [ ] **Step 3: Full suite** — all pass.
- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main/index.ts
git commit -m "feat(main): wire plugin installer — boot probe, install handler, guarded relaunch"
```

---

### Task 4: GameAudioSettings UI

**Files:**
- Create: `packages/app/src/renderer/components/GameAudioSettings.tsx`
- Modify: `packages/app/src/renderer/components/SettingsScreen.tsx`
- Test: `packages/app/test/game-audio-settings.test.tsx`; `settings-screen.test.tsx` fixture if its state is hand-built

**Interfaces:**
- Consumes: `GameAudioPluginView`, `StreamPhase` (Task 2 / existing); `axi.installGameAudioPlugin` / `axi.relaunchApp`.
- Produces: `GameAudioSettings({ plugin, phase })`.

- [ ] **Step 1: Failing tests** — `packages/app/test/game-audio-settings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GameAudioSettings } from '../src/renderer/components/GameAudioSettings.js'

const axi = { installGameAudioPlugin: vi.fn(async () => {}), relaunchApp: vi.fn(async () => {}) }
beforeEach(() => { (globalThis as any).axi = axi; vi.clearAllMocks() })

const p = (status: string, error: string | null = null) => ({ status: status as any, error })

describe('GameAudioSettings', () => {
  it('unsupported: explains the flatpak requirement, no buttons', () => {
    render(<GameAudioSettings plugin={p('unsupported')} phase="READY" />)
    expect(screen.getByText(/requires the OBS flatpak/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('missing: install button triggers the API', () => {
    render(<GameAudioSettings plugin={p('missing')} phase="READY" />)
    fireEvent.click(screen.getByText('Install plugin'))
    expect(axi.installGameAudioPlugin).toHaveBeenCalled()
  })
  it('installing: disabled button', () => {
    render(<GameAudioSettings plugin={p('installing')} phase="READY" />)
    expect(screen.getByText(/installing/i).closest('button')).toBeDisabled()
  })
  it('installed: restart button relaunches', () => {
    render(<GameAudioSettings plugin={p('installed')} phase="READY" />)
    fireEvent.click(screen.getByText('Restart AxiStream'))
    expect(axi.relaunchApp).toHaveBeenCalled()
  })
  it('installed while LIVE: restart button hidden', () => {
    render(<GameAudioSettings plugin={p('installed')} phase="LIVE" />)
    expect(screen.queryByText('Restart AxiStream')).toBeNull()
    expect(screen.getByText(/restart AxiStream to activate/i)).toBeInTheDocument()
  })
  it('ready: shows Ready, no buttons', () => {
    render(<GameAudioSettings plugin={p('ready')} phase="READY" />)
    expect(screen.getByText(/ready/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('error: shows message and Retry install', () => {
    render(<GameAudioSettings plugin={p('error', 'boom from flatpak')} phase="READY" />)
    expect(screen.getByText('boom from flatpak')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Retry install'))
    expect(axi.installGameAudioPlugin).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2:** Run `npm -w @axistream/app run test -- test/game-audio-settings.test.tsx` → FAIL (module missing)
- [ ] **Step 3: Implement** — `packages/app/src/renderer/components/GameAudioSettings.tsx`:

```tsx
import { Loader2 } from 'lucide-react'
import type { AxiApi, AppState, StreamPhase } from '../../shared/state.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi
const LIVE_PHASES: StreamPhase[] = ['GOING_LIVE', 'LIVE', 'RECONNECTING']

export function GameAudioSettings({ plugin, phase }: { plugin: AppState['gameAudioPlugin']; phase: StreamPhase }) {
  const { status, error } = plugin
  return (
    <section className="yt-settings">
      <h3>Game audio</h3>
      {status === 'unsupported' && <p className="muted">Per-app game audio requires the OBS flatpak.</p>}
      {status === 'missing' && (
        <>
          <p className="muted">Capture only your game's audio — needs a free OBS plugin.</p>
          <button className="btn ghost" onClick={() => axi().installGameAudioPlugin()}>Install plugin</button>
        </>
      )}
      {status === 'installing' && (
        <button className="btn ghost" disabled><Loader2 size={12} className="spin" /> Installing…</button>
      )}
      {status === 'installed' && (
        <>
          <p className="muted">Installed — restart AxiStream to activate.</p>
          {LIVE_PHASES.includes(phase) ? null : (
            <button className="btn ghost" onClick={() => axi().relaunchApp()}>Restart AxiStream</button>
          )}
        </>
      )}
      {status === 'ready' && <p className="ok">Ready ✓</p>}
      {status === 'error' && (
        <>
          <p className="muted mono">{error}</p>
          <button className="btn ghost" onClick={() => axi().installGameAudioPlugin()}>Retry install</button>
        </>
      )}
    </section>
  )
}
```

If `styles.css` has no `.ok` class, add next to the muted/status styles: `.ok { color: #7be3a0; font-size: 13px; }` (match the palette of `.chip.good`).

- [ ] **Step 4: Mount** — in `SettingsScreen.tsx`, after the Audio section:

```tsx
        <section className="setting">
          <GameAudioSettings plugin={state.gameAudioPlugin} phase={state.phase} />
        </section>
```

with `import { GameAudioSettings } from './GameAudioSettings.js'`.

- [ ] **Step 5:** Full suite + typecheck → green/zero (fix any hand-built fixture in `settings-screen.test.tsx` by adding `gameAudioPlugin: { status: 'missing', error: null }` if the compiler flags it).
- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/components/GameAudioSettings.tsx packages/app/src/renderer/components/SettingsScreen.tsx packages/app/src/renderer/styles.css packages/app/test/game-audio-settings.test.tsx
git commit -m "feat(ui): game-audio plugin install section in Settings"
```

(Include `settings-screen.test.tsx` if touched.)

---

## Final verification (whole branch)

- `npm -w @axistream/app run test` green; `cd packages/app && npx tsc --noEmit -p tsconfig.json` zero errors.
- Manual smoke (human): Settings shows "Install plugin" → click → flatpak extension installs (`flatpak info com.obsproject.Studio.Plugin.PipeWireAudioCapture` succeeds) → "Restart AxiStream" → after relaunch, status Ready and the `[game-audio] input kinds` log line captured for spec B.
