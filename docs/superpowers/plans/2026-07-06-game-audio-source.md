# Per-App Game Audio Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture only the game's audio via an "AxiStream Game Audio" OBS source (PipeWire app capture), with a running-app picker in Settings and desktop audio auto-disabled when game audio turns on.

**Architecture:** `GameAudioController` (main, house pattern) reconciles the `pipewire_audio_application_capture` input against persisted `gameAudioEnabled`/`gameAudioTarget`; state/IPC/preload follow the audio-slice pattern; the spec-A `GameAudioSettings` component grows a toggle + app picker for the `ready` status. Spec: `docs/superpowers/specs/2026-07-06-game-audio-source-design.md` (settings schema is live-probed ground truth, not guesses).

**Tech Stack:** obs-websocket-js 5 via sidecar client, React 18, Vitest 2.

## Global Constraints

- No new dependencies.
- Code style: 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on relative imports.
- Exact OBS values: input name `AxiStream Game Audio`, kind `pipewire_audio_application_capture`, scene `Main`, input settings `{ CaptureMode: 0, TargetName: <target ?? ''>, MatchPriorty: 0 }` — **`MatchPriorty` is the plugin's own spelling; do not "fix" it.** App enumeration property: `TargetName`.
- Semantics: no input created until first enable (zero OBS footprint); disabled = muted, not removed; enabling game audio persists desktop audio OFF (one-way — disabling does not restore it).
- Exact copy: stale picker label `'Saved app (not running)'`; empty-list option `'No apps playing audio'`; placeholder option `'Choose an application…'`; hint `"Pick Guild Wars 2 while it's running. Desktop audio turns off automatically — game audio replaces it."`
- All OBS calls best-effort (`console.warn`, never throw); nothing blocks boot or go-live. Boot/rebuild `ensure` calls are gated on `state.gameAudioPlugin.status === 'ready'`.
- Gates: `npm -w @axistream/app run test` per task; Tasks 4–5 also `cd packages/app && npx tsc --noEmit -p tsconfig.json` (Task 3 leaves index.ts red until Task 4 — the usual staged gap).

---

## File Structure

**New:** `packages/app/src/main/GameAudioController.ts` (+ `test/game-audio-controller.test.ts`).
**Modified:** `src/main/StreamSettings.ts` (Task 2), `src/shared/state.ts` + `src/main/ipc.ts` + `src/preload/index.ts` (Task 3), `src/main/index.ts` (Task 4), `src/renderer/device-options.ts` + `src/renderer/components/GameAudioSettings.tsx` + `SettingsScreen.tsx` (Task 5); tests alongside.

---

### Task 1: GameAudioController

**Files:**
- Create: `packages/app/src/main/GameAudioController.ts`
- Test: `packages/app/test/game-audio-controller.test.ts`

**Interfaces:**
- Produces: `GAME_AUDIO = 'AxiStream Game Audio'`, `GAME_AUDIO_KIND = 'pipewire_audio_application_capture'`; `class GameAudioController { constructor(d: { client(): { call(req: string, data?: unknown): Promise<any> } }); ensure(s: { gameAudioEnabled: boolean; gameAudioTarget: string | null }): Promise<void>; listApps(): Promise<AudioDevice[]>; setTarget(target: string): Promise<void>; setEnabled(enabled: boolean): Promise<void> }` (`AudioDevice` imported from `./AudioController.js`).

- [ ] **Step 1: Write the failing tests** — `packages/app/test/game-audio-controller.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { GameAudioController, GAME_AUDIO, GAME_AUDIO_KIND } from '../src/main/GameAudioController.js'

function recorder(opts: { inputs?: string[]; noSceneItem?: boolean; items?: { itemName: string; itemValue: string }[] } = {}) {
  const calls: { req: string; data: any }[] = []
  const client = () => ({
    call: vi.fn(async (req: string, data?: any) => {
      calls.push({ req, data })
      if (req === 'GetInputList') return { inputs: (opts.inputs ?? []).map((inputName) => ({ inputName })) }
      if (req === 'GetSceneItemId') {
        if (opts.noSceneItem) throw new Error('not in scene')
        return { sceneItemId: 7 }
      }
      if (req === 'CreateSceneItem') return { sceneItemId: 8 }
      if (req === 'GetInputPropertiesListPropertyItems') return { propertyItems: opts.items ?? [] }
      return {}
    }),
  })
  return { calls, client }
}

describe('GameAudioController.ensure', () => {
  it('does nothing when disabled and the input does not exist (zero footprint)', async () => {
    const r = recorder()
    await new GameAudioController({ client: r.client }).ensure({ gameAudioEnabled: false, gameAudioTarget: null })
    expect(r.calls.map((c) => c.req)).toEqual(['GetInputList'])
  })

  it('first enable creates the input with exact kind and settings, then unmutes', async () => {
    const r = recorder()
    await new GameAudioController({ client: r.client }).ensure({ gameAudioEnabled: true, gameAudioTarget: 'gw2-64.exe' })
    const create = r.calls.find((c) => c.req === 'CreateInput')
    expect(create?.data).toEqual({
      sceneName: 'Main', inputName: GAME_AUDIO, inputKind: GAME_AUDIO_KIND,
      inputSettings: { CaptureMode: 0, TargetName: 'gw2-64.exe', MatchPriorty: 0 },
    })
    const mute = r.calls.find((c) => c.req === 'SetInputMute')
    expect(mute?.data).toEqual({ inputName: GAME_AUDIO, inputMuted: false })
  })

  it('null target creates with empty TargetName', async () => {
    const r = recorder()
    await new GameAudioController({ client: r.client }).ensure({ gameAudioEnabled: true, gameAudioTarget: null })
    expect(r.calls.find((c) => c.req === 'CreateInput')?.data.inputSettings.TargetName).toBe('')
  })

  it('existing input gets SetInputSettings (no duplicate CreateInput) and mute state', async () => {
    const r = recorder({ inputs: [GAME_AUDIO] })
    await new GameAudioController({ client: r.client }).ensure({ gameAudioEnabled: false, gameAudioTarget: 'gw2-64.exe' })
    expect(r.calls.some((c) => c.req === 'CreateInput')).toBe(false)
    expect(r.calls.find((c) => c.req === 'SetInputSettings')?.data).toEqual({
      inputName: GAME_AUDIO, inputSettings: { CaptureMode: 0, TargetName: 'gw2-64.exe', MatchPriorty: 0 }, overlay: true,
    })
    expect(r.calls.find((c) => c.req === 'SetInputMute')?.data).toEqual({ inputName: GAME_AUDIO, inputMuted: true })
  })

  it('re-adds the scene item when a rebuild dropped it', async () => {
    const r = recorder({ inputs: [GAME_AUDIO], noSceneItem: true })
    await new GameAudioController({ client: r.client }).ensure({ gameAudioEnabled: true, gameAudioTarget: 'x' })
    expect(r.calls.find((c) => c.req === 'CreateSceneItem')?.data).toEqual({ sceneName: 'Main', sourceName: GAME_AUDIO })
  })

  it('throwing client is swallowed', async () => {
    const client = () => ({ call: vi.fn(async () => { throw new Error('boom') }) })
    await expect(new GameAudioController({ client }).ensure({ gameAudioEnabled: true, gameAudioTarget: null })).resolves.toBeUndefined()
  })
})

describe('GameAudioController.listApps / setTarget / setEnabled', () => {
  it('listApps maps TargetName property items to {id,name}', async () => {
    const r = recorder({ items: [{ itemName: 'Guild Wars 2', itemValue: 'gw2-64.exe' }] })
    const apps = await new GameAudioController({ client: r.client }).listApps()
    expect(apps).toEqual([{ id: 'gw2-64.exe', name: 'Guild Wars 2' }])
    expect(r.calls[0].data).toEqual({ inputName: GAME_AUDIO, propertyName: 'TargetName' })
  })

  it('listApps returns [] on error', async () => {
    const client = () => ({ call: vi.fn(async () => { throw new Error('no input') }) })
    await expect(new GameAudioController({ client }).listApps()).resolves.toEqual([])
  })

  it('setTarget overlays TargetName; setEnabled toggles mute', async () => {
    const r = recorder()
    const g = new GameAudioController({ client: r.client })
    await g.setTarget('gw2-64.exe')
    expect(r.calls[0]).toEqual({ req: 'SetInputSettings', data: { inputName: GAME_AUDIO, inputSettings: { TargetName: 'gw2-64.exe' }, overlay: true } })
    await g.setEnabled(true)
    expect(r.calls[1]).toEqual({ req: 'SetInputMute', data: { inputName: GAME_AUDIO, inputMuted: false } })
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/app run test -- test/game-audio-controller.test.ts` → FAIL (module missing)
- [ ] **Step 3: Implement** — `packages/app/src/main/GameAudioController.ts`:

```ts
import type { AudioDevice } from './AudioController.js'

export const GAME_AUDIO = 'AxiStream Game Audio'
export const GAME_AUDIO_KIND = 'pipewire_audio_application_capture'
const SCENE = 'Main'

export interface GameAudioDeps {
  client(): { call(req: string, data?: unknown): Promise<any> }
}

// Reconciles the per-app game-audio input (PipeWire app capture plugin)
// against the persisted settings. No input exists until the feature is
// first enabled; disabled thereafter means muted, mirroring desktop/mic.
// Settings keys (CaptureMode/TargetName/MatchPriorty — the plugin's own
// spelling) are live-probed ground truth; see the spec's ground-truth
// section. Best-effort throughout — never blocks boot or go-live.
export class GameAudioController {
  constructor(private readonly d: GameAudioDeps) {}

  private settingsFor(target: string | null) {
    return { CaptureMode: 0, TargetName: target ?? '', MatchPriorty: 0 }
  }

  async ensure(s: { gameAudioEnabled: boolean; gameAudioTarget: string | null }): Promise<void> {
    try {
      const c = this.d.client()
      const { inputs } = await c.call('GetInputList') as { inputs?: { inputName: string }[] }
      const exists = (inputs ?? []).some((i) => i.inputName === GAME_AUDIO)
      if (!exists && !s.gameAudioEnabled) return
      if (!exists) {
        await c.call('CreateInput', { sceneName: SCENE, inputName: GAME_AUDIO, inputKind: GAME_AUDIO_KIND, inputSettings: this.settingsFor(s.gameAudioTarget) })
      } else {
        await c.call('SetInputSettings', { inputName: GAME_AUDIO, inputSettings: this.settingsFor(s.gameAudioTarget), overlay: true })
        // A capture rebuild recreates the scene but not its items — re-add.
        try { await c.call('GetSceneItemId', { sceneName: SCENE, sourceName: GAME_AUDIO }) }
        catch { await c.call('CreateSceneItem', { sceneName: SCENE, sourceName: GAME_AUDIO }) }
      }
      await c.call('SetInputMute', { inputName: GAME_AUDIO, inputMuted: !s.gameAudioEnabled })
    } catch (e) { console.warn('[game-audio] ensure failed', e) }
  }

  async listApps(): Promise<AudioDevice[]> {
    try {
      const r = await this.d.client().call('GetInputPropertiesListPropertyItems', {
        inputName: GAME_AUDIO, propertyName: 'TargetName',
      })
      return (r.propertyItems ?? []).map((it: { itemName: string; itemValue: string }) => ({ id: it.itemValue, name: it.itemName }))
    } catch (e) { console.warn('[game-audio] listApps failed', e); return [] }
  }

  async setTarget(target: string): Promise<void> {
    try { await this.d.client().call('SetInputSettings', { inputName: GAME_AUDIO, inputSettings: { TargetName: target }, overlay: true }) }
    catch (e) { console.warn('[game-audio] setTarget failed', e) }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    try { await this.d.client().call('SetInputMute', { inputName: GAME_AUDIO, inputMuted: !enabled }) }
    catch (e) { console.warn('[game-audio] setEnabled failed', e) }
  }
}
```

- [ ] **Step 4: Run to verify pass** — same command → 9 passed
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/GameAudioController.ts packages/app/test/game-audio-controller.test.ts
git commit -m "feat(game-audio): controller for the per-app capture input"
```

---

### Task 2: StreamSettings fields

**Files:**
- Modify: `packages/app/src/main/StreamSettings.ts`
- Test: `packages/app/test/stream-settings.test.ts` (append)

**Interfaces:**
- Produces: `StreamSettingsData.gameAudioEnabled: boolean` (default `false`, boolean-validated like `desktopEnabled`); `gameAudioTarget: string | null` (default `null`, string-or-null like `micDevice`).

- [ ] **Step 1: Write the failing tests** — append (reuse the file's temp-path pattern):

```ts
describe('game audio settings', () => {
  it('defaults: disabled, no target; round-trips', () => {
    const s = new StreamSettings(file)
    expect(s.load().gameAudioEnabled).toBe(false)
    expect(s.load().gameAudioTarget).toBeNull()
    s.patch({ gameAudioEnabled: true, gameAudioTarget: 'gw2-64.exe' })
    expect(s.load()).toMatchObject({ gameAudioEnabled: true, gameAudioTarget: 'gw2-64.exe' })
  })

  it('invalid types fall back to defaults', () => {
    writeFileSync(file, JSON.stringify({ gameAudioEnabled: 'yes', gameAudioTarget: 42 }))
    const s = new StreamSettings(file)
    expect(s.load().gameAudioEnabled).toBe(false)
    expect(s.load().gameAudioTarget).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/app run test -- test/stream-settings.test.ts` → FAIL
- [ ] **Step 3: Implement** — add both fields to `StreamSettingsData` and `DEFAULT_SETTINGS`; in `load()` add `gameAudioEnabled: typeof raw.gameAudioEnabled === 'boolean' ? raw.gameAudioEnabled : DEFAULT_SETTINGS.gameAudioEnabled,` and `gameAudioTarget: typeof raw.gameAudioTarget === 'string' ? raw.gameAudioTarget : null,`
- [ ] **Step 4: Run to verify pass** — same command → all pass
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/StreamSettings.ts packages/app/test/stream-settings.test.ts
git commit -m "feat(settings): persist game-audio enabled + target"
```

---

### Task 3: Shared state + IPC + preload

**Files:**
- Modify: `packages/app/src/shared/state.ts`, `packages/app/src/main/ipc.ts`, `packages/app/src/preload/index.ts`
- Test: `packages/app/test/ipc-contract.test.ts` (append)

**Interfaces:**
- Produces: `AppState.audio` gains `gameAudioEnabled: boolean` + `gameAudioTarget: string | null` (INITIAL_STATE: `false` / `null`); `CH.setGameAudioEnabled = 'axi:setGameAudioEnabled'`, `CH.setGameAudioTarget = 'axi:setGameAudioTarget'`, `CH.getGameAudioApps = 'axi:getGameAudioApps'`; `AxiApi`/`IpcHandlers`: `setGameAudioEnabled(enabled: boolean): Promise<void>`, `setGameAudioTarget(target: string): Promise<void>`, `getGameAudioApps(): Promise<AudioDevice[]>`.

- [ ] **Step 1: Failing test** — add the three channels to `ipc-contract.test.ts`'s `commandChannels` (+ `vi.fn()` stubs in the handlers mock).
- [ ] **Step 2:** `npm -w @axistream/app run test -- test/ipc-contract.test.ts` → FAIL
- [ ] **Step 3: Implement.** `state.ts`: two audio-slice fields + INITIAL_STATE + three channels + three `AxiApi` methods. `ipc.ts`: three `IpcHandlers` methods; registrations `ipcMain.handle(CH.setGameAudioEnabled, (_e: unknown, enabled: boolean) => handlers.setGameAudioEnabled(enabled))`, `ipcMain.handle(CH.setGameAudioTarget, (_e: unknown, target: string) => handlers.setGameAudioTarget(target))`, `ipcMain.handle(CH.getGameAudioApps, () => handlers.getGameAudioApps())`. `preload/index.ts`: three invoke one-liners.
- [ ] **Step 4:** ipc-contract passes; full suite passes (fixtures hand-building the audio slice need the two fields — the compiler will name them; include those files in the commit). Typecheck red ONLY in `src/main/index.ts` until Task 4 — verify and note.
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/main/ipc.ts packages/app/src/preload/index.ts packages/app/test/ipc-contract.test.ts
git commit -m "feat(state): game-audio fields + channels"
```

(Include fixture files touched.)

---

### Task 4: Main wiring + desktop interplay

**Files:**
- Modify: `packages/app/src/main/index.ts`
- Test: suites + typecheck (seams tested in Tasks 1–3)

**Interfaces:**
- Consumes: `GameAudioController` (Task 1), settings fields (Task 2), handlers (Task 3), existing `audio.setDesktopEnabled`, `state.gameAudioPlugin.status`.

- [ ] **Step 1: Wire it.** In `index.ts`:
  - `import { GameAudioController } from './GameAudioController.js'`; construct `const gameAudio = new GameAudioController({ client: () => sidecar.client() })` next to `maskCtl`/`installer`.
  - Handlers (beside the audio setters):

```ts
    setGameAudioEnabled: async (enabled: boolean) => {
      settings.patch({ gameAudioEnabled: enabled })
      await gameAudio.ensure(settings.load())
      let audioPatch: Partial<AppState['audio']> = { gameAudioEnabled: enabled }
      // Opinionated interplay: game audio replaces desktop audio — otherwise
      // viewers hear the game twice. One-way: disabling doesn't restore it.
      if (enabled && state.audio.desktopEnabled) {
        settings.patch({ desktopEnabled: false })
        await audio.setDesktopEnabled(false)
        audioPatch = { ...audioPatch, desktopEnabled: false }
      }
      setState({ audio: { ...state.audio, ...audioPatch } })
    },
    setGameAudioTarget: async (target: string) => {
      settings.patch({ gameAudioTarget: target })
      await gameAudio.setTarget(target)
      setState({ audio: { ...state.audio, gameAudioTarget: target } })
    },
    getGameAudioApps: () => gameAudio.listApps(),
```

(Note: `ensure` already applies the mute for the new enabled state, so no separate `setEnabled` call is needed in the handler.)
  - Boot (provisioned branch): the audio-slice `setState` gains the two fields from the loaded settings (`gameAudioEnabled: a.gameAudioEnabled, gameAudioTarget: a.gameAudioTarget`). Immediately AFTER the `[game-audio] input kinds` probe block (which sets `state.gameAudioPlugin`), add:

```ts
      if (state.gameAudioPlugin.status === 'ready') await gameAudio.ensure(a)
```

  - Rebuild handlers (`provision`, `repairCapture`, `switchSource`): after the existing `await maskCtl.applyMasks(masks)`, add `if (state.gameAudioPlugin.status === 'ready') await gameAudio.ensure(settings.load())`.
- [ ] **Step 2: Typecheck** — zero errors (Task 3's staged gap closes).
- [ ] **Step 3: Full suite** — all pass.
- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main/index.ts
git commit -m "feat(main): wire game-audio controller — handlers, boot/rebuild ensure, desktop interplay"
```

---

### Task 5: UI — picker in GameAudioSettings

**Files:**
- Modify: `packages/app/src/renderer/device-options.ts`, `packages/app/src/renderer/components/GameAudioSettings.tsx`, `packages/app/src/renderer/components/SettingsScreen.tsx`
- Test: `packages/app/test/device-options.test.ts` (append), `packages/app/test/game-audio-settings.test.tsx` (extend)

**Interfaces:**
- Consumes: `staleOption` (gains optional label param), `axi.setGameAudioEnabled`/`setGameAudioTarget`/`getGameAudioApps` (Tasks 3–4), `AppState['audio']` fields.
- Produces: `staleOption(saved: string | null, devices: DeviceOption[], label = 'Saved device (unavailable)'): DeviceOption | null`; `GameAudioSettings({ plugin, phase, audio })`.

- [ ] **Step 1: Failing tests.**

Append to `packages/app/test/device-options.test.ts`:

```ts
  it('custom label is used when provided; default unchanged', () => {
    expect(staleOption('gone', devs, 'Saved app (not running)')).toEqual({ id: 'gone', name: 'Saved app (not running)' })
    expect(staleOption('gone', devs)).toEqual({ id: 'gone', name: 'Saved device (unavailable)' })
  })
```

Extend `packages/app/test/game-audio-settings.test.tsx` — update the axi mock with `setGameAudioEnabled: vi.fn(async () => {})`, `setGameAudioTarget: vi.fn(async () => {})`, `getGameAudioApps: vi.fn(async () => [{ id: 'gw2-64.exe', name: 'Guild Wars 2' }])`; add a default `audio` fixture `const audio = { desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioEnabled: false, gameAudioTarget: null }` and pass `audio={audio}` in ALL existing renders (they gain the prop); append:

```tsx
  it('ready: shows the game-audio toggle; enabling calls the API', () => {
    render(<GameAudioSettings plugin={p('ready')} phase="READY" audio={audio} />)
    fireEvent.click(screen.getByLabelText(/game audio/i))
    expect(axi.setGameAudioEnabled).toHaveBeenCalledWith(true)
  })

  it('ready + enabled: picker lists running apps and selection sets the target', async () => {
    render(<GameAudioSettings plugin={p('ready')} phase="READY" audio={{ ...audio, gameAudioEnabled: true }} />)
    expect(axi.getGameAudioApps).toHaveBeenCalled()
    await screen.findByRole('option', { name: 'Guild Wars 2' })
    fireEvent.change(screen.getByLabelText(/application/i), { target: { value: 'gw2-64.exe' } })
    expect(axi.setGameAudioTarget).toHaveBeenCalledWith('gw2-64.exe')
  })

  it('saved app not in the running list renders the not-running placeholder', async () => {
    render(<GameAudioSettings plugin={p('ready')} phase="READY" audio={{ ...audio, gameAudioEnabled: true, gameAudioTarget: 'closed-game.exe' }} />)
    expect(await screen.findByText('Saved app (not running)')).toBeInTheDocument()
    const select = screen.getByLabelText(/application/i) as HTMLSelectElement
    expect(select.value).toBe('closed-game.exe')
  })

  it('non-ready statuses do not render the toggle (regression)', () => {
    render(<GameAudioSettings plugin={p('missing')} phase="READY" audio={audio} />)
    expect(screen.queryByLabelText(/game audio/i)).toBeNull()
  })
```

- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/app run test -- test/device-options.test.ts test/game-audio-settings.test.tsx` → FAIL
- [ ] **Step 3: Implement.**

`device-options.ts` — add the label parameter:

```ts
export function staleOption(saved: string | null, devices: DeviceOption[], label = 'Saved device (unavailable)'): DeviceOption | null {
  if (!saved) return null
  if (devices.some((d) => d.id === saved)) return null
  return { id: saved, name: label }
}
```

`GameAudioSettings.tsx` — props become `{ plugin, phase, audio }: { plugin: AppState['gameAudioPlugin']; phase: StreamPhase; audio: AppState['audio'] }`. Add imports `useEffect, useState`, `AudioDevice`, `staleOption` (`from '../device-options.js'`). Inside the component:

```tsx
  const [apps, setApps] = useState<AudioDevice[] | null>(null)
  useEffect(() => {
    if (status !== 'ready' || !audio.gameAudioEnabled) return
    axi().getGameAudioApps().then(setApps)
  }, [status, audio.gameAudioEnabled])
```

Replace the `ready` branch:

```tsx
      {status === 'ready' && (
        <>
          <label className="audio-row">
            <input type="checkbox" checked={audio.gameAudioEnabled} aria-label="Game audio"
              onChange={(e) => axi().setGameAudioEnabled(e.target.checked)} />
            <span>Game audio</span>
          </label>
          {audio.gameAudioEnabled && (() => {
            const stale = apps ? staleOption(audio.gameAudioTarget, apps, 'Saved app (not running)') : null
            return (
              <label>Application
                <select value={audio.gameAudioTarget ?? ''} onChange={(e) => axi().setGameAudioTarget(e.target.value)}>
                  {stale && <option value={stale.id}>{stale.name}</option>}
                  {!audio.gameAudioTarget && !stale && <option value="">Choose an application…</option>}
                  {apps?.length === 0 && !stale && <option value="">No apps playing audio</option>}
                  {(apps ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            )
          })()}
          <p className="muted">Pick Guild Wars 2 while it's running. Desktop audio turns off automatically — game audio replaces it.</p>
        </>
      )}
```

`SettingsScreen.tsx`: pass `audio={state.audio}` to `<GameAudioSettings ... />`.

- [ ] **Step 4: Run everything** — targeted tests pass, full suite passes, `cd packages/app && npx tsc --noEmit -p tsconfig.json` zero errors (spec-A's `'ready'` test asserted "no buttons" — a checkbox is an input, not a button; if any old assertion conflicts with the new ready branch, update it to assert the toggle instead and note it in your report).
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/renderer/device-options.ts packages/app/test/device-options.test.ts packages/app/src/renderer/components/GameAudioSettings.tsx packages/app/src/renderer/components/SettingsScreen.tsx packages/app/test/game-audio-settings.test.tsx
git commit -m "feat(ui): game-audio toggle + running-app picker in Settings"
```

---

## Final verification (whole branch)

- `npm -w @axistream/app run test` green; typecheck zero.
- Manual smoke (human, GW2 running): enable Game audio → desktop toggle switches off; pick Guild Wars 2 in the picker; stream/monitor carries game + mic only; close GW2 → picker shows 'Saved app (not running)'; app restart preserves everything.
