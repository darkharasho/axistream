# "What Viewers Hear" Checkbox List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One checkbox list in Audio settings — "All desktop audio" XOR a multi-select of running apps (plugin multi-app capture) — replacing the desktop toggle + single-app picker.

**Architecture:** `GameAudioController.ensure` switches to `CaptureMode: 1` with the plugin's `apps` array format; `StreamSettings` replaces `gameAudioEnabled`/`gameAudioTarget` with `gameAudioApps: string[]` (with legacy migration); one `setGameAudioApps` channel replaces the two setters; both `setGameAudioApps` and `setDesktopEnabled(true)` enforce the exclusivity invariant; `AudioSettings` renders the hear-list (absorbing the app UI from `GameAudioSettings`, which shrinks to install/restart states). Spec: `docs/superpowers/specs/2026-07-06-audio-hear-list-design.md` (plugin formats are source-quoted ground truth).

**Tech Stack:** obs-websocket-js 5, React 18, Vitest 2.

## Global Constraints

- No new dependencies; 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on relative imports.
- Exact OBS values: input settings `{ CaptureMode: 1, apps: [{ value, hidden: false, selected: false }, ...], MatchPriorty: 0 }` (`MatchPriorty` = plugin's own spelling); enumeration property `'AppToAdd'`; input `AxiStream Game Audio`, kind `pipewire_audio_application_capture`, scene `Main`.
- Semantics: zero footprint until first non-empty selection; empty selection = muted (input kept); exclusivity BOTH ways (apps selected ⇒ desktop off; desktop on ⇒ apps cleared); mic untouched.
- Sanitize rule (shared helper): trim, drop non-/empty strings, dedupe, cap 16.
- Migration in `load()`: no `gameAudioApps` key + legacy `gameAudioEnabled === true` + non-empty string `gameAudioTarget` → `[gameAudioTarget]`; else `[]`.
- Exact copy: `'All desktop audio'`, sub ` — everything your speakers play`, divider `Only these apps`, pill `not running`, hint `"Pick your game to keep Discord and music off the stream. Checking an app switches off desktop audio automatically."`
- Gates per task: `npm -w @axistream/app run test`; Tasks 4–5 also `cd packages/app && npx tsc --noEmit -p tsconfig.json` (Task 3 leaves index.ts + UI red until Tasks 4–5 — note whatever the staged set is in your report).

---

## File Structure

**Modified only** (no new files): `src/main/GameAudioController.ts` (T1), `src/main/StreamSettings.ts` (T2), `src/shared/state.ts` + `src/main/ipc.ts` + `src/preload/index.ts` (T3), `src/main/index.ts` (T4), `src/renderer/components/AudioSettings.tsx` + `GameAudioSettings.tsx` + `SettingsScreen.tsx` + `styles.css` (T5); tests alongside.

---

### Task 1: GameAudioController — multi-app mode

**Files:**
- Modify: `packages/app/src/main/GameAudioController.ts`
- Test: `packages/app/test/game-audio-controller.test.ts` (rewrite the affected cases)

**Interfaces:**
- Produces: `ensure(s: { gameAudioApps: string[] }): Promise<void>`; `listApps()` unchanged signature but property `'AppToAdd'`; `setEnabled` kept as-is; **`setTarget` deleted** (Task 4 stops calling it; nothing else does).

- [ ] **Step 1: Rewrite the failing tests.** In `game-audio-controller.test.ts`, replace the `ensure` describe-block cases and the `listApps/setTarget/setEnabled` block with:

```ts
const appsArr = (...values: string[]) => values.map((value) => ({ value, hidden: false, selected: false }))

describe('GameAudioController.ensure (multi-app)', () => {
  it('does nothing when selection is empty and the input does not exist (zero footprint)', async () => {
    const r = recorder()
    await new GameAudioController({ client: r.client }).ensure({ gameAudioApps: [] })
    expect(r.calls.map((c) => c.req)).toEqual(['GetInputList'])
  })

  it('first selection creates the input with CaptureMode 1 and the plugin apps format, then unmutes', async () => {
    const r = recorder()
    await new GameAudioController({ client: r.client }).ensure({ gameAudioApps: ['gw2-64.exe', 'Discord'] })
    const create = r.calls.find((c) => c.req === 'CreateInput')
    expect(create?.data).toEqual({
      sceneName: 'Main', inputName: GAME_AUDIO, inputKind: GAME_AUDIO_KIND,
      inputSettings: { CaptureMode: 1, apps: appsArr('gw2-64.exe', 'Discord'), MatchPriorty: 0 },
    })
    expect(r.calls.find((c) => c.req === 'SetInputMute')?.data).toEqual({ inputName: GAME_AUDIO, inputMuted: false })
  })

  it('existing input gets SetInputSettings with the new apps array and mute when emptied', async () => {
    const r = recorder({ inputs: [GAME_AUDIO] })
    await new GameAudioController({ client: r.client }).ensure({ gameAudioApps: [] })
    expect(r.calls.some((c) => c.req === 'CreateInput')).toBe(false)
    expect(r.calls.find((c) => c.req === 'SetInputSettings')?.data).toEqual({
      inputName: GAME_AUDIO, inputSettings: { CaptureMode: 1, apps: [], MatchPriorty: 0 }, overlay: true,
    })
    expect(r.calls.find((c) => c.req === 'SetInputMute')?.data).toEqual({ inputName: GAME_AUDIO, inputMuted: true })
  })

  it('re-adds the scene item when a rebuild dropped it', async () => {
    const r = recorder({ inputs: [GAME_AUDIO], noSceneItem: true })
    await new GameAudioController({ client: r.client }).ensure({ gameAudioApps: ['x'] })
    expect(r.calls.find((c) => c.req === 'CreateSceneItem')?.data).toEqual({ sceneName: 'Main', sourceName: GAME_AUDIO })
  })

  it('throwing client is swallowed', async () => {
    const client = () => ({ call: vi.fn(async () => { throw new Error('boom') }) })
    await expect(new GameAudioController({ client }).ensure({ gameAudioApps: ['x'] })).resolves.toBeUndefined()
  })
})

describe('GameAudioController.listApps / setEnabled', () => {
  it('listApps enumerates the AppToAdd property', async () => {
    const r = recorder({ items: [{ itemName: 'Guild Wars 2', itemValue: 'gw2-64.exe' }] })
    const apps = await new GameAudioController({ client: r.client }).listApps()
    expect(apps).toEqual([{ id: 'gw2-64.exe', name: 'Guild Wars 2' }])
    expect(r.calls[0].data).toEqual({ inputName: GAME_AUDIO, propertyName: 'AppToAdd' })
  })

  it('listApps returns [] on error', async () => {
    const client = () => ({ call: vi.fn(async () => { throw new Error('no input') }) })
    await expect(new GameAudioController({ client }).listApps()).resolves.toEqual([])
  })

  it('setEnabled toggles mute', async () => {
    const r = recorder()
    await new GameAudioController({ client: r.client }).setEnabled(true)
    expect(r.calls[0]).toEqual({ req: 'SetInputMute', data: { inputName: GAME_AUDIO, inputMuted: false } })
  })
})
```

(Keep the existing `recorder` helper unchanged.)
- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/app run test -- test/game-audio-controller.test.ts` → FAIL (old signatures)
- [ ] **Step 3: Implement.** In `GameAudioController.ts`:
  - `settingsFor` becomes:

```ts
  private settingsFor(apps: string[]) {
    // Plugin multi-app format: it reads only `value` from each item
    // (pipewire-audio-capture-app.c); hidden/selected are the OBS
    // editable-list conventions.
    return { CaptureMode: 1, apps: apps.map((value) => ({ value, hidden: false, selected: false })), MatchPriorty: 0 }
  }
```

  - `ensure(s: { gameAudioApps: string[] })`: replace the two `s.gameAudioEnabled`/`s.gameAudioTarget` usages — early return when `!exists && s.gameAudioApps.length === 0`; `this.settingsFor(s.gameAudioApps)` in both create/update paths; final mute `inputMuted: s.gameAudioApps.length === 0`.
  - `listApps`: `propertyName: 'AppToAdd'`.
  - Delete `setTarget` entirely.
- [ ] **Step 4: Run to verify pass** — controller tests green, full suite green (vitest doesn't compile `index.ts`, so its stale `ensure`/`setTarget` calls don't break tests). Typecheck is red ONLY in `src/main/index.ts` — the staged gap Tasks 3–4 track; note it in your report.
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/GameAudioController.ts packages/app/test/game-audio-controller.test.ts
git commit -m "feat(game-audio): multi-app capture mode in the controller"
```

---

### Task 2: StreamSettings — gameAudioApps + migration

**Files:**
- Modify: `packages/app/src/main/StreamSettings.ts`
- Test: `packages/app/test/stream-settings.test.ts` (replace the game-audio block)

**Interfaces:**
- Produces: `StreamSettingsData.gameAudioApps: string[]` (default `[]`); **`gameAudioEnabled`/`gameAudioTarget` removed from the interface and defaults**; exported `sanitizeGameAudioApps(raw: unknown): string[]` (trim, drop non-/empty strings, dedupe, cap 16) used by `load()` and later by the Task 4 handler.

- [ ] **Step 1: Replace the failing tests.** Swap the `'game audio settings'` describe block for:

```ts
describe('gameAudioApps', () => {
  it('defaults to [] and round-trips', () => {
    const s = new StreamSettings(file)
    expect(s.load().gameAudioApps).toEqual([])
    s.patch({ gameAudioApps: ['gw2-64.exe', 'Discord'] })
    expect(s.load().gameAudioApps).toEqual(['gw2-64.exe', 'Discord'])
  })

  it('sanitizes: trims, drops junk, dedupes, caps at 16', () => {
    writeFileSync(file, JSON.stringify({ gameAudioApps: [' gw2-64.exe ', '', 42, 'gw2-64.exe', ...Array.from({ length: 20 }, (_, i) => `app${i}`)] }))
    const apps = new StreamSettings(file).load().gameAudioApps
    expect(apps[0]).toBe('gw2-64.exe')
    expect(apps).toHaveLength(16)
    expect(new Set(apps).size).toBe(16)
  })

  it('migrates legacy enabled+target to a one-app list', () => {
    writeFileSync(file, JSON.stringify({ gameAudioEnabled: true, gameAudioTarget: 'gw2-64.exe' }))
    expect(new StreamSettings(file).load().gameAudioApps).toEqual(['gw2-64.exe'])
  })

  it('legacy disabled or empty target migrates to []', () => {
    writeFileSync(file, JSON.stringify({ gameAudioEnabled: false, gameAudioTarget: 'gw2-64.exe' }))
    expect(new StreamSettings(file).load().gameAudioApps).toEqual([])
    writeFileSync(file, JSON.stringify({ gameAudioEnabled: true, gameAudioTarget: '' }))
    expect(new StreamSettings(file).load().gameAudioApps).toEqual([])
  })

  it('new key present → legacy ignored', () => {
    writeFileSync(file, JSON.stringify({ gameAudioApps: ['Discord'], gameAudioEnabled: true, gameAudioTarget: 'gw2-64.exe' }))
    expect(new StreamSettings(file).load().gameAudioApps).toEqual(['Discord'])
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/app run test -- test/stream-settings.test.ts` → FAIL
- [ ] **Step 3: Implement.**

```ts
export function sanitizeGameAudioApps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    if (out.length >= 16) break
    if (typeof v !== 'string') continue
    const name = v.trim()
    if (!name || out.includes(name)) continue
    out.push(name)
  }
  return out
}
```

In `StreamSettingsData`/`DEFAULT_SETTINGS`: `gameAudioApps: string[]` / `[]`; delete the two legacy fields. In `load()` replace the two legacy lines with:

```ts
      gameAudioApps: 'gameAudioApps' in raw
        ? sanitizeGameAudioApps(raw.gameAudioApps)
        : ((raw as Record<string, unknown>).gameAudioEnabled === true && typeof (raw as Record<string, unknown>).gameAudioTarget === 'string' && ((raw as Record<string, unknown>).gameAudioTarget as string).trim()
            ? [((raw as Record<string, unknown>).gameAudioTarget as string).trim()]
            : []),
```

(`raw` is already `Partial<StreamSettingsData>` — the legacy keys are no longer in the type, hence the record casts. If the file's existing style prefers, hoist a small `migrateLegacyGameAudio(raw)` helper above the class instead of the inline ternary — either is acceptable; keep the behavior exactly as the tests specify.)
- [ ] **Step 4: Run to verify pass** — stream-settings green; full suite green (typecheck now red in index.ts for BOTH the controller and the removed settings fields — staged, note it).
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/StreamSettings.ts packages/app/test/stream-settings.test.ts
git commit -m "feat(settings): gameAudioApps list with legacy migration"
```

---

### Task 3: Shared state + IPC + preload

**Files:**
- Modify: `packages/app/src/shared/state.ts`, `packages/app/src/main/ipc.ts`, `packages/app/src/preload/index.ts`
- Test: `packages/app/test/ipc-contract.test.ts` (update)

**Interfaces:**
- Produces: `AppState.audio.gameAudioApps: string[]` (INITIAL_STATE `[]`) — `gameAudioEnabled`/`gameAudioTarget` removed from the audio slice; `CH.setGameAudioApps = 'axi:setGameAudioApps'` REPLACES `setGameAudioEnabled`/`setGameAudioTarget` (delete those channels + methods everywhere); `AxiApi`/`IpcHandlers.setGameAudioApps(apps: string[]): Promise<void>`; `getGameAudioApps` unchanged.

- [ ] **Step 1: Failing test** — in `ipc-contract.test.ts`: remove the two old channels from `commandChannels` and the mock, add `CH.setGameAudioApps` + `setGameAudioApps: vi.fn()`.
- [ ] **Step 2:** `npm -w @axistream/app run test -- test/ipc-contract.test.ts` → FAIL
- [ ] **Step 3: Implement.** `state.ts`: audio slice swaps the two fields for `gameAudioApps: string[]`; INITIAL_STATE `[]`; channel + `AxiApi` swap. `ipc.ts`: `setGameAudioApps(apps: string[]): Promise<void>` in `IpcHandlers`; `ipcMain.handle(CH.setGameAudioApps, (_e: unknown, apps: string[]) => handlers.setGameAudioApps(apps))`; delete the two old registrations/methods. `preload/index.ts`: swap the two invokes for one.
- [ ] **Step 4:** ipc-contract green; full suite — renderer tests referencing the old fields will fail to compile under vitest? They reference `gameAudioEnabled` in fixtures/props: update ALL fixtures (`audio-settings.test.tsx`, `settings-screen.test.tsx`, `stream-screen.test.tsx`, `game-audio-settings.test.tsx`) replacing `gameAudioEnabled: false, gameAudioTarget: null` with `gameAudioApps: []`. `GameAudioSettings.tsx`/`AudioSettings.tsx` still compile against removed fields → tsc red in those + index.ts (Tasks 4–5 close them); BUT vitest must still run — if `game-audio-settings.test.tsx`'s ready-branch tests now fail at runtime (component reads `audio.gameAudioEnabled` → undefined → toggle unchecked), delete the ready-branch tests in THIS task with a note (Task 5 replaces that UI wholesale). Record exactly what you deferred.
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/main/ipc.ts packages/app/src/preload/index.ts packages/app/test/ipc-contract.test.ts
git commit -m "feat(state): gameAudioApps replaces enabled+target"
```

(Include fixture/test files touched.)

---

### Task 4: Main wiring — both-ways exclusivity

**Files:**
- Modify: `packages/app/src/main/index.ts`
- Test: suites + typecheck

**Interfaces:**
- Consumes: `ensure({ gameAudioApps })` (T1), `sanitizeGameAudioApps` (T2 — extend the existing `StreamSettings.js` import), `setGameAudioApps` handler slot (T3).

- [ ] **Step 1: Wire it.**
  - Replace the `setGameAudioEnabled`/`setGameAudioTarget` handlers with:

```ts
    setGameAudioApps: async (apps: string[]) => {
      const next = sanitizeGameAudioApps(apps)
      settings.patch({ gameAudioApps: next })
      await gameAudio.ensure(settings.load())
      let audioPatch: Partial<AppState['audio']> = { gameAudioApps: next }
      // Exclusivity: per-app selection replaces desktop audio.
      if (next.length > 0 && state.audio.desktopEnabled) {
        settings.patch({ desktopEnabled: false })
        await audio.setDesktopEnabled(false)
        audioPatch = { ...audioPatch, desktopEnabled: false }
      }
      setState({ audio: { ...state.audio, ...audioPatch } })
    },
```

  - Extend the EXISTING `setDesktopEnabled` handler for the reverse direction (keep its current body; add the clearing branch before the final setState and fold the fields into ONE setState):

```ts
    setDesktopEnabled: async (enabled: boolean) => {
      settings.patch({ desktopEnabled: enabled })
      await audio.setDesktopEnabled(enabled)
      let audioPatch: Partial<AppState['audio']> = { desktopEnabled: enabled }
      // Exclusivity, reverse direction: turning desktop audio on clears the
      // per-app selection (and mutes the game-audio input via ensure).
      if (enabled && state.audio.gameAudioApps.length > 0) {
        settings.patch({ gameAudioApps: [] })
        await gameAudio.ensure(settings.load())
        audioPatch = { ...audioPatch, gameAudioApps: [] }
      }
      setState({ audio: { ...state.audio, ...audioPatch } })
    },
```

  - Boot audio-slice setState: replace the two old fields with `gameAudioApps: a.gameAudioApps`. The boot/rebuild `ensure` call sites are unchanged (they already pass `settings.load()`, which now carries `gameAudioApps`).
- [ ] **Step 2: Typecheck** — `cd packages/app && npx tsc --noEmit -p tsconfig.json`: red ONLY in the two renderer components now (Task 5); `src/main/**` clean. Note the remaining set.
- [ ] **Step 3: Full suite** — all pass.
- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main/index.ts
git commit -m "feat(main): setGameAudioApps + two-way desktop exclusivity"
```

---

### Task 5: UI — the hear-list

**Files:**
- Modify: `packages/app/src/renderer/components/AudioSettings.tsx`, `packages/app/src/renderer/components/GameAudioSettings.tsx`, `packages/app/src/renderer/components/SettingsScreen.tsx`, `packages/app/src/renderer/styles.css`
- Test: `packages/app/test/audio-settings.test.tsx` (extend), `packages/app/test/game-audio-settings.test.tsx` (reduce)

**Interfaces:**
- Consumes: `axi.setGameAudioApps(apps)`, `axi.getGameAudioApps()`, `audio.gameAudioApps`, `AppState['gameAudioPlugin']`.
- Produces: `AudioSettings({ audio, gameAudioPlugin })`; `GameAudioSettings({ plugin, phase })` (loses `audio`; renders `null` when status is `ready`).

- [ ] **Step 1: Failing tests.**

`audio-settings.test.tsx` — update the mock (`setGameAudioApps: vi.fn(async () => {})`, `getGameAudioApps: vi.fn(async () => [{ id: 'gw2-64.exe', name: 'Guild Wars 2' }, { id: 'Discord', name: 'Discord' }])`), update every render to the new props (audio fixtures use `gameAudioApps: []`; add `gameAudioPlugin={{ status: 'ready', error: null }}` — non-ready variants where noted), keep all existing desktop/mic/stale assertions (the All row is still a checkbox labeled "Desktop audio"? NO — new label). **Existing desktop-audio tests change label:** the All row checkbox uses `aria-label="All desktop audio"`; update `getByLabelText(/desktop audio/i)` matchers accordingly (they still match). Append:

```tsx
  it('checking an app calls setGameAudioApps with the union', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" />)
    fireEvent.click(await screen.findByLabelText('Guild Wars 2'))
    expect(axi.setGameAudioApps).toHaveBeenCalledWith(['gw2-64.exe'])
  })

  it('unchecking an app calls setGameAudioApps without it', async () => {
    render(<AudioSettings audio={{ desktopEnabled: false, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: ['gw2-64.exe', 'Discord'] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" />)
    fireEvent.click(await screen.findByLabelText('Guild Wars 2'))
    expect(axi.setGameAudioApps).toHaveBeenCalledWith(['Discord'])
  })

  it('checking All desktop audio while apps are selected still just calls setDesktopEnabled(true)', async () => {
    render(<AudioSettings audio={{ desktopEnabled: false, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: ['gw2-64.exe'] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" />)
    fireEvent.click(screen.getByLabelText('All desktop audio'))
    expect(axi.setDesktopEnabled).toHaveBeenCalledWith(true)
  })

  it('saved app absent from the running list shows the not-running pill', async () => {
    axi.getGameAudioApps.mockResolvedValueOnce([{ id: 'Discord', name: 'Discord' }])
    render(<AudioSettings audio={{ desktopEnabled: false, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: ['closed-game.exe'] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" />)
    expect(await screen.findByText('not running')).toBeInTheDocument()
    expect(screen.getByLabelText('closed-game.exe')).toBeChecked()
  })

  it('refresh re-enumerates', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" />)
    await screen.findByLabelText('Guild Wars 2')
    fireEvent.click(screen.getByTitle('Refresh running apps'))
    expect(axi.getGameAudioApps).toHaveBeenCalledTimes(2)
  })

  it('plugin not ready: no app rows, install flow renders instead', () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={{ status: 'missing', error: null }} phase="READY" />)
    expect(axi.getGameAudioApps).not.toHaveBeenCalled()
    expect(screen.getByText('Install plugin')).toBeInTheDocument()
  })
```

`game-audio-settings.test.tsx` — drop the ready-branch tests (moved above); add `it('ready renders nothing', ...)` asserting `container.firstChild` is null; keep unsupported/missing/installing/installed/error tests (component props lose `audio`).

- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/app run test -- test/audio-settings.test.tsx test/game-audio-settings.test.tsx` → FAIL
- [ ] **Step 3: Implement.**

`GameAudioSettings.tsx`: props back to `{ plugin, phase }`; delete the ready branch (return `null` when `status === 'ready'`); delete the apps state/effect and `staleOption` import if now unused; keep everything else.

`AudioSettings.tsx` (full new body):

```tsx
import { useEffect, useState } from 'react'
import { RotateCw } from 'lucide-react'
import type { AxiApi, AudioDevice, AppState } from '../../shared/state.js'
import { staleOption } from '../device-options.js'
import { GameAudioSettings } from './GameAudioSettings.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi

export function AudioSettings({ audio, gameAudioPlugin, phase }: { audio: AppState['audio']; gameAudioPlugin: AppState['gameAudioPlugin']; phase: AppState['phase'] }) {
  const [micDevices, setMicDevices] = useState<AudioDevice[] | null>(null)
  const [outputDevices, setOutputDevices] = useState<AudioDevice[] | null>(null)
  const [runningApps, setRunningApps] = useState<AudioDevice[] | null>(null)
  const pluginReady = gameAudioPlugin.status === 'ready'

  useEffect(() => {
    if (!audio.micEnabled) return
    axi().getAudioDevices().then(setMicDevices)
  }, [audio.micEnabled])

  useEffect(() => {
    if (!audio.desktopEnabled) return
    axi().getDesktopDevices().then(setOutputDevices)
  }, [audio.desktopEnabled])

  useEffect(() => {
    if (!pluginReady) return
    axi().getGameAudioApps().then(setRunningApps)
  }, [pluginReady])

  const refreshApps = () => { axi().getGameAudioApps().then(setRunningApps) }
  const toggleApp = (id: string) => {
    const next = audio.gameAudioApps.includes(id)
      ? audio.gameAudioApps.filter((a) => a !== id)
      : [...audio.gameAudioApps, id]
    void axi().setGameAudioApps(next)
  }
  // Saved selections stay listed (checked) even when not currently running.
  const rows = [
    ...(runningApps ?? []),
    ...audio.gameAudioApps.filter((id) => !(runningApps ?? []).some((r) => r.id === id)).map((id) => ({ id, name: id })),
  ]
  const isRunning = (id: string) => (runningApps ?? []).some((r) => r.id === id)

  return (
    <section className="yt-settings">
      <h3>Audio</h3>

      <div className="hear-list">
        <label className="hear-row all">
          <input type="checkbox" checked={audio.desktopEnabled} aria-label="All desktop audio"
            onChange={(e) => axi().setDesktopEnabled(e.target.checked)} />
          <span>All desktop audio</span>
          <span className="sub"> — everything your speakers play</span>
        </label>

        {audio.desktopEnabled && (() => {
          const stale = outputDevices ? staleOption(audio.desktopDevice, outputDevices) : null
          return (
            <label className="hear-devrow">Output device
              <select value={audio.desktopDevice ?? ''} onChange={(e) => axi().setDesktopDevice(e.target.value)}>
                {stale && <option value={stale.id}>{stale.name}</option>}
                {outputDevices?.length === 0 && !stale && <option value="">No output devices found</option>}
                {(outputDevices ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )
        })()}

        <div className="hear-divider">
          <span>Only these apps</span>
          <div className="line" />
          {pluginReady && (
            <button className="hear-refresh" title="Refresh running apps" onClick={refreshApps}><RotateCw size={12} /></button>
          )}
        </div>

        {pluginReady ? rows.map((app) => (
          <label key={app.id} className="hear-row">
            <input type="checkbox" checked={audio.gameAudioApps.includes(app.id)} aria-label={app.name}
              onChange={() => toggleApp(app.id)} />
            <span>{app.name}</span>
            {!isRunning(app.id) && <span className="hear-pill">not running</span>}
          </label>
        )) : (
          <div className="hear-install"><GameAudioSettings plugin={gameAudioPlugin} phase={phase} /></div>
        )}
      </div>
      {pluginReady && (
        <p className="muted">Pick your game to keep Discord and music off the stream. Checking an app switches off desktop audio automatically.</p>
      )}

      <label className="audio-row">
        <input type="checkbox" checked={audio.micEnabled} aria-label="Microphone"
          onChange={(e) => axi().setMicEnabled(e.target.checked)} />
        <span>Microphone</span>
      </label>

      {audio.micEnabled && (() => {
        const stale = micDevices ? staleOption(audio.micDevice, micDevices) : null
        return (
          <label>Microphone device
            <select value={audio.micDevice ?? ''} onChange={(e) => axi().setMicDevice(e.target.value)}>
              {stale && <option value={stale.id}>{stale.name}</option>}
              {micDevices?.length === 0 && !stale && <option value="">No input devices found</option>}
              {(micDevices ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        )
      })()}
    </section>
  )
}
```

`SettingsScreen.tsx`: `<AudioSettings audio={state.audio} gameAudioPlugin={state.gameAudioPlugin} phase={state.phase} />`; DELETE the separate `<GameAudioSettings>` section (it now renders inside the list when the plugin isn't ready).

`styles.css` — append (mockup-derived, matching the existing palette):

```css
/* "What viewers hear" checkbox list (Audio settings). */
.hear-list { border: 1px solid #1d2530; border-radius: 10px; overflow: hidden; }
.hear-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; font-size: 13px; color: #c7d0d9; cursor: pointer; }
.hear-row:hover { background: #131a24; }
.hear-row input { accent-color: #22d3ee; width: 15px; height: 15px; cursor: pointer; }
.hear-row.all span:first-of-type { font-weight: 600; }
.hear-row .sub { color: #768390; font-size: 12px; }
.hear-pill { color: #fbbf24; font-size: 11px; font-weight: 500; background: rgba(251,191,36,.08); border: 1px solid rgba(251,191,36,.25); border-radius: 999px; padding: 1px 8px; }
.hear-divider { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: #0b0f15; border-top: 1px solid #1d2530; border-bottom: 1px solid #1d2530; }
.hear-divider span { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: #566070; font-weight: 600; }
.hear-divider .line { flex: 1; height: 1px; background: #1d2530; }
.hear-refresh { margin-left: auto; background: none; border: none; color: #566070; cursor: pointer; padding: 2px 4px; border-radius: 6px; display: grid; place-items: center; }
.hear-refresh:hover { color: #22d3ee; background: #131a24; }
.hear-devrow { display: flex; flex-direction: column; gap: 5px; padding: 8px 12px 10px 37px; background: #0b0f15; border-top: 1px solid #1d2530; font-size: 12px; color: #8b949e; }
.hear-install { padding: 10px 12px; }
```

- [ ] **Step 4: Run everything** — targeted + full suite green; `cd packages/app && npx tsc --noEmit -p tsconfig.json` zero errors. If existing audio-settings assertions relied on the old "Desktop audio" label or layout, update them to the new structure and record each change in your report.
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/renderer/components/AudioSettings.tsx packages/app/src/renderer/components/GameAudioSettings.tsx packages/app/src/renderer/components/SettingsScreen.tsx packages/app/src/renderer/styles.css packages/app/test/audio-settings.test.tsx packages/app/test/game-audio-settings.test.tsx
git commit -m "feat(ui): what-viewers-hear checkbox list — All desktop XOR multi-app"
```

---

## Final verification (whole branch)

- Full suite green; typecheck zero.
- Manual smoke (human): GW2 + Discord checked stream both, music off; checking All flips back (apps clear, device picker returns); saved app shows "not running" pill when closed; legacy stream.json (old target) migrates to a checked app.
