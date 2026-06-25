# Desktop Audio Output Device Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an output-device picker for desktop audio, mirroring the existing mic device picker, so users can choose which playback device's audio to stream.

**Architecture:** Refactor `AudioController`'s device logic into shared `listDevicesFor`/`setDeviceFor` helpers, add `listDesktopDevices`/`setDesktopDevice`, persist `desktopDevice`, expose it through state/IPC/preload, and add an output dropdown to `AudioSettings`. No new dependency. Direct mirror of the mic picker.

**Tech Stack:** Electron 31, React 18, TypeScript 5.5, Vitest 2, obs-websocket-js 5.

## Global Constraints

- No new runtime dependency.
- Target input is `AxiStream Desktop Audio` (the `DESKTOP_AUDIO` constant already exported from `AudioController.ts`).
- obs-websocket shapes (already used): `SetInputSettings { inputName, inputSettings: { device_id }, overlay: true }`; `GetInputPropertiesListPropertyItems { inputName, propertyName: 'device_id' }` → `{ propertyItems: Array<{ itemName: string; itemValue: string }> }`.
- All `AudioController` calls best-effort: swallow + log, never throw out; list returns `[]` on error.
- `desktopDevice` default `null` (= OBS default device). Apply guard is truthy (`if (s.desktopDevice)`), consistent with the existing mic guard.
- Code style: 2-space indent, NO semicolons, single quotes, named exports; `.js` extensions on relative imports.
- Real typecheck: `cd packages/app && npx tsc --noEmit -p tsconfig.json` (electron-vite `build` does NOT typecheck). Tests: `npm -w @axistream/app run test`.
- NOTE: `packages/capture`'s `tsc` build has a PRE-EXISTING failure in `test/capture-resolution.test.ts` (unrelated). This feature only touches `packages/app`; use the app tsc + vitest as the gates.

---

## File Structure

**Modified:**
- `packages/app/src/main/AudioController.ts` (+ `packages/app/test/audio-controller.test.ts`)
- `packages/app/src/main/StreamSettings.ts` (+ `packages/app/test/stream-settings.test.ts`)
- `packages/app/src/shared/state.ts`
- `packages/app/test/settings-screen.test.tsx`, `packages/app/test/stream-screen.test.tsx` (fixtures: add `desktopDevice`)
- `packages/app/src/main/ipc.ts`
- `packages/app/src/preload/index.ts`
- `packages/app/src/main/index.ts`
- `packages/app/src/renderer/components/AudioSettings.tsx` (+ `packages/app/test/audio-settings.test.tsx`)

---

## Task 1: AudioController — shared device helpers + desktop methods

**Files:**
- Modify: `packages/app/src/main/AudioController.ts`
- Modify: `packages/app/test/audio-controller.test.ts`

**Interfaces:**
- Produces: private `listDevicesFor(inputName)` / `setDeviceFor(inputName, id)`; public `listDesktopDevices(): Promise<AudioDevice[]>`, `setDesktopDevice(deviceId: string): Promise<void>`; `setMicDevice`/`listMicDevices` keep the same external behavior; `applySettings` signature becomes `{ desktopEnabled: boolean; desktopDevice: string | null; micEnabled: boolean; micDevice: string | null }`.

- [ ] **Step 1: Update/add tests**

In `packages/app/test/audio-controller.test.ts`: (a) update the existing `applySettings` test object to include `desktopDevice`, (b) add desktop-device tests. Replace the existing `applySettings` test and add two new tests:

```typescript
it('setDesktopDevice sets device_id on the desktop input', async () => {
  const r = recorder()
  const a = new AudioController({ client: r.client })
  await a.setDesktopDevice('out-2')
  expect(r.calls[0]).toEqual({ req: 'SetInputSettings', data: { inputName: DESKTOP_AUDIO, inputSettings: { device_id: 'out-2' }, overlay: true } })
})

it('listDesktopDevices maps property items from the desktop input', async () => {
  const r = recorder({ GetInputPropertiesListPropertyItems: { propertyItems: [
    { itemName: 'HDMI', itemValue: 'hdmi.monitor' },
  ] } })
  const a = new AudioController({ client: r.client })
  expect(await a.listDesktopDevices()).toEqual([{ id: 'hdmi.monitor', name: 'HDMI' }])
  expect(r.calls[0].data).toEqual({ inputName: DESKTOP_AUDIO, propertyName: 'device_id' })
})

it('applySettings applies desktop device, mic device, then desktop+mic mute', async () => {
  const r = recorder()
  const a = new AudioController({ client: r.client })
  await a.applySettings({ desktopEnabled: false, desktopDevice: 'out-9', micEnabled: true, micDevice: 'mic-9' })
  expect(r.calls.map((c) => c.req)).toEqual(['SetInputSettings', 'SetInputSettings', 'SetInputMute', 'SetInputMute'])
  expect(r.calls[0].data).toEqual({ inputName: DESKTOP_AUDIO, inputSettings: { device_id: 'out-9' }, overlay: true })
  expect(r.calls[1].data).toEqual({ inputName: MIC, inputSettings: { device_id: 'mic-9' }, overlay: true })
  expect(r.calls[2].data).toEqual({ inputName: DESKTOP_AUDIO, inputMuted: true })
  expect(r.calls[3].data).toEqual({ inputName: MIC, inputMuted: false })
})
```

(The existing `setMicDevice`/`listMicDevices`/mute/error-swallow tests stay unchanged and must still pass.)

- [ ] **Step 2: Run to verify fail**

Run: `npm -w @axistream/app run test -- audio-controller`
Expected: FAIL — `setDesktopDevice`/`listDesktopDevices` not defined; `applySettings` arg shape changed.

- [ ] **Step 3: Implement**

Replace the device methods + `applySettings` in `AudioController.ts` (keep `mute`, `setDesktopEnabled`, `setMicEnabled` as-is):

```typescript
  private async setDeviceFor(inputName: string, deviceId: string): Promise<void> {
    try {
      await this.d.client().call('SetInputSettings', {
        inputName, inputSettings: { device_id: deviceId }, overlay: true,
      })
    } catch (e) { console.warn('[audio] SetInputSettings failed', e) }
  }

  private async listDevicesFor(inputName: string): Promise<AudioDevice[]> {
    try {
      const r = await this.d.client().call('GetInputPropertiesListPropertyItems', {
        inputName, propertyName: 'device_id',
      })
      return (r.propertyItems ?? []).map((it: { itemName: string; itemValue: string }) => ({
        id: it.itemValue, name: it.itemName,
      }))
    } catch (e) { console.warn('[audio] list devices failed', e); return [] }
  }

  async setMicDevice(deviceId: string): Promise<void> { await this.setDeviceFor(MIC, deviceId) }
  async listMicDevices(): Promise<AudioDevice[]> { return this.listDevicesFor(MIC) }
  async setDesktopDevice(deviceId: string): Promise<void> { await this.setDeviceFor(DESKTOP_AUDIO, deviceId) }
  async listDesktopDevices(): Promise<AudioDevice[]> { return this.listDevicesFor(DESKTOP_AUDIO) }

  async applySettings(s: { desktopEnabled: boolean; desktopDevice: string | null; micEnabled: boolean; micDevice: string | null }): Promise<void> {
    if (s.desktopDevice) await this.setDesktopDevice(s.desktopDevice)
    if (s.micDevice) await this.setMicDevice(s.micDevice)
    await this.setDesktopEnabled(s.desktopEnabled)
    await this.setMicEnabled(s.micEnabled)
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npm -w @axistream/app run test -- audio-controller`
Expected: PASS (existing + new).

NOTE: this changes `applySettings`'s required shape, so `index.ts`'s boot call (which doesn't pass `desktopDevice` yet) will be a `tsc` error until Task 5. Expected/staged — do not fix index.ts here. Verify with the focused test, not a full typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/AudioController.ts packages/app/test/audio-controller.test.ts
git commit -m "feat(audio): shared device helpers + desktop device methods"
```

---

## Task 2: StreamSettings — desktopDevice

**Files:**
- Modify: `packages/app/src/main/StreamSettings.ts`
- Modify: `packages/app/test/stream-settings.test.ts`

**Interfaces:**
- Produces: `StreamSettingsData.desktopDevice: string | null` (default `null`).

- [ ] **Step 1: Add failing test**

Append inside the existing describe:

```typescript
it('defaults desktopDevice to null and persists it', () => {
  expect(new StreamSettings(file).load().desktopDevice).toBe(null)
  new StreamSettings(file).patch({ desktopDevice: 'alsa_output.hdmi.monitor' })
  expect(new StreamSettings(file).load().desktopDevice).toBe('alsa_output.hdmi.monitor')
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npm -w @axistream/app run test -- stream-settings`
Expected: FAIL — `desktopDevice` undefined.

- [ ] **Step 3: Implement**

Add to `StreamSettingsData`: `desktopDevice: string | null`. Add to `DEFAULT_SETTINGS`: `desktopDevice: null,`. Add to `load()` validation (next to `micDevice`):

```typescript
    desktopDevice: typeof raw.desktopDevice === 'string' ? raw.desktopDevice : null,
```

- [ ] **Step 4: Run to verify pass**

Run: `npm -w @axistream/app run test -- stream-settings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/StreamSettings.ts packages/app/test/stream-settings.test.ts
git commit -m "feat(settings): persist desktopDevice"
```

---

## Task 3: State, channels, AxiApi + fixtures

**Files:**
- Modify: `packages/app/src/shared/state.ts`
- Modify: `packages/app/test/settings-screen.test.tsx`, `packages/app/test/stream-screen.test.tsx`

**Interfaces:**
- Produces: `AppState.audio.desktopDevice: string | null`; `INITIAL_STATE.audio.desktopDevice = null`; `CH.getDesktopDevices = 'axi:getDesktopDevices'`, `CH.setDesktopDevice = 'axi:setDesktopDevice'`; `AxiApi.getDesktopDevices(): Promise<AudioDevice[]>`, `AxiApi.setDesktopDevice(deviceId: string): Promise<void>`.

- [ ] **Step 1: Edit `state.ts`**

In `AppState.audio`, add `desktopDevice: string | null`:

```typescript
  audio: { desktopEnabled: boolean; desktopDevice: string | null; micEnabled: boolean; micDevice: string | null }
```

In `INITIAL_STATE.audio`:

```typescript
  audio: { desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null },
```

In `CH` (before `} as const`):

```typescript
  getDesktopDevices: 'axi:getDesktopDevices',
  setDesktopDevice: 'axi:setDesktopDevice',
```

In `AxiApi` (next to the existing audio methods):

```typescript
  getDesktopDevices: () => Promise<AudioDevice[]>
  setDesktopDevice: (deviceId: string) => Promise<void>
```

- [ ] **Step 2: Fix existing AppState fixtures**

In BOTH `settings-screen.test.tsx` and `stream-screen.test.tsx`, update the `audio` field in the `AppState` fixture(s) to include `desktopDevice`:

```typescript
  audio: { desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null },
```

- [ ] **Step 3: Verify + scope gap**

Run: `npm -w @axistream/app run test -- settings-screen stream-screen`
Expected: PASS.

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: remaining errors confined to `src/preload/index.ts` (AxiApi not yet implemented — Task 4), `src/main/index.ts` (handlers + applySettings — Task 5). None in `state.ts` or the two fixtures. Staged — do not fix consumers here.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/test/settings-screen.test.tsx packages/app/test/stream-screen.test.tsx
git commit -m "feat(state): desktopDevice field + getDesktopDevices/setDesktopDevice"
```

---

## Task 4: IPC handlers + preload API

**Files:**
- Modify: `packages/app/src/main/ipc.ts`
- Modify: `packages/app/src/preload/index.ts`

**Interfaces:**
- Consumes: `CH`/`AxiApi`/`AudioDevice` from Task 3.
- Produces: `IpcHandlers` gains `getDesktopDevices`/`setDesktopDevice`; `registerIpc` registers them; preload `api` forwards them.

- [ ] **Step 1: Extend `ipc.ts`**

Add to `IpcHandlers` (next to the other audio methods):

```typescript
  getDesktopDevices(): Promise<AudioDevice[]>
  setDesktopDevice(deviceId: string): Promise<void>
```

Add to `registerIpc`:

```typescript
  ipcMain.handle(CH.getDesktopDevices, () => handlers.getDesktopDevices())
  ipcMain.handle(CH.setDesktopDevice, (_e: unknown, deviceId: string) => handlers.setDesktopDevice(deviceId))
```

- [ ] **Step 2: Extend `preload/index.ts`**

Add to the `api` object (matching the existing audio method style):

```typescript
  getDesktopDevices: () => ipcRenderer.invoke(CH.getDesktopDevices) as Promise<AudioDevice[]>,
  setDesktopDevice: (deviceId) => ipcRenderer.invoke(CH.setDesktopDevice, deviceId) as Promise<void>,
```

(`AudioDevice` is already imported in preload from the mic work; reuse it.)

- [ ] **Step 3: Typecheck (expect only index.ts gap)**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: remaining errors ONLY in `src/main/index.ts` (handlers missing the 2 methods + applySettings arg — Task 5). None in `ipc.ts`/`preload`.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main/ipc.ts packages/app/src/preload/index.ts
git commit -m "feat(ipc): desktop audio device channels"
```

---

## Task 5: Main wiring

**Files:**
- Modify: `packages/app/src/main/index.ts`

**Interfaces:**
- Consumes: `AudioController.listDesktopDevices/setDesktopDevice` (Task 1), `StreamSettings.desktopDevice` (Task 2), `CH`/`AppState.audio.desktopDevice`/`IpcHandlers` (Tasks 3–4).
- Produces: two handlers + updated boot `applySettings` + `setState` seed including `desktopDevice`. Closes the staged tsc gap.

- [ ] **Step 1: Add the two handlers**

In the `handlers` object (next to the existing audio handlers):

```typescript
  getDesktopDevices: () => audio.listDesktopDevices(),
  setDesktopDevice: async (deviceId: string) => {
    settings.patch({ desktopDevice: deviceId })
    await audio.setDesktopDevice(deviceId)
    setState({ audio: { ...state.audio, desktopDevice: deviceId } })
  },
```

- [ ] **Step 2: Pass desktopDevice through the boot apply + state seed**

In the provisioned-boot block, update the audio seed + `applySettings` call to carry `desktopDevice`:

```typescript
      const a = settings.load()
      setState({ audio: { desktopEnabled: a.desktopEnabled, desktopDevice: a.desktopDevice, micEnabled: a.micEnabled, micDevice: a.micDevice } })
      await audio.applySettings({ desktopEnabled: a.desktopEnabled, desktopDevice: a.desktopDevice, micEnabled: a.micEnabled, micDevice: a.micDevice })
```

- [ ] **Step 3: Full typecheck + tests**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` → ZERO errors.
Run: `npm -w @axistream/app run test` → all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main/index.ts
git commit -m "feat(main): wire desktop device handlers + apply on boot"
```

---

## Task 6: AudioSettings — output device dropdown

**Files:**
- Modify: `packages/app/src/renderer/components/AudioSettings.tsx`
- Modify: `packages/app/test/audio-settings.test.tsx`
- Modify: `packages/app/test/settings-screen.test.tsx` (stub the 2 new axi methods)

**Interfaces:**
- Consumes: `axi.getDesktopDevices/setDesktopDevice`, `state.audio.desktopDevice`.

- [ ] **Step 1: Add failing tests**

Add to `packages/app/test/audio-settings.test.tsx` — first extend the mocked `axi` with the new methods:

```typescript
  getDesktopDevices: vi.fn(async () => [{ id: 'default', name: 'Default' }, { id: 'hdmi', name: 'HDMI' }]),
  setDesktopDevice: vi.fn(async () => {}),
```

Then add tests:

```typescript
it('populates the output dropdown when desktop audio is on and selection calls setDesktopDevice', async () => {
  render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null }} />)
  expect(axi.getDesktopDevices).toHaveBeenCalled()
  await waitFor(() => expect(screen.getByRole('option', { name: 'HDMI' })).toBeInTheDocument())
  fireEvent.change(screen.getByLabelText(/output device/i), { target: { value: 'hdmi' } })
  expect(axi.setDesktopDevice).toHaveBeenCalledWith('hdmi')
})

it('does not query output devices when desktop audio is off', () => {
  render(<AudioSettings audio={{ desktopEnabled: false, desktopDevice: null, micEnabled: false, micDevice: null }} />)
  expect(axi.getDesktopDevices).not.toHaveBeenCalled()
})
```

(Existing mic tests must still pass; the mic device picker uses `getAudioDevices` and the existing render assertions are unchanged.)

- [ ] **Step 2: Run to verify fail**

Run: `npm -w @axistream/app run test -- audio-settings`
Expected: FAIL — no output dropdown / `aria-label`.

- [ ] **Step 3: Implement**

Update `AudioSettings.tsx`: rename the mic devices state for clarity and add an output-devices state + effect, and render the output dropdown under the desktop toggle. Full component:

```tsx
import { useEffect, useState } from 'react'
import type { AxiApi, AudioDevice, AppState } from '../../shared/state.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi

export function AudioSettings({ audio }: { audio: AppState['audio'] }) {
  const [micDevices, setMicDevices] = useState<AudioDevice[]>([])
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([])

  useEffect(() => {
    if (!audio.micEnabled) return
    axi().getAudioDevices().then(setMicDevices)
  }, [audio.micEnabled])

  useEffect(() => {
    if (!audio.desktopEnabled) return
    axi().getDesktopDevices().then(setOutputDevices)
  }, [audio.desktopEnabled])

  return (
    <section className="yt-settings">
      <h3>Audio</h3>

      <label className="audio-row">
        <input type="checkbox" checked={audio.desktopEnabled} aria-label="Desktop audio"
          onChange={(e) => axi().setDesktopEnabled(e.target.checked)} />
        <span>Desktop audio</span>
      </label>

      {audio.desktopEnabled && (
        <label>Output device
          <select value={audio.desktopDevice ?? ''} onChange={(e) => axi().setDesktopDevice(e.target.value)}>
            {outputDevices.length === 0 && <option value="">No output devices found</option>}
            {outputDevices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      )}

      <label className="audio-row">
        <input type="checkbox" checked={audio.micEnabled} aria-label="Microphone"
          onChange={(e) => axi().setMicEnabled(e.target.checked)} />
        <span>Microphone</span>
      </label>

      {audio.micEnabled && (
        <label>Microphone device
          <select value={audio.micDevice ?? ''} onChange={(e) => axi().setMicDevice(e.target.value)}>
            {micDevices.length === 0 && <option value="">No input devices found</option>}
            {micDevices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Stub in settings-screen test**

In `packages/app/test/settings-screen.test.tsx`, add to the mocked `axi`:

```typescript
  getDesktopDevices: vi.fn(async () => []),
  setDesktopDevice: vi.fn(async () => {}),
```

- [ ] **Step 5: Run tests + full typecheck**

Run: `npm -w @axistream/app run test -- audio-settings settings-screen` → PASS.
Run: `npm -w @axistream/app run test` → all pass.
Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` → ZERO errors.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/components/AudioSettings.tsx packages/app/test/audio-settings.test.tsx packages/app/test/settings-screen.test.tsx
git commit -m "feat(ui): desktop audio output device picker"
```

---

## Final verification

- [ ] `npm -w @axistream/app run test` — all green.
- [ ] `cd packages/app && npx tsc --noEmit -p tsconfig.json` — zero errors.
- [ ] **Manual smoke:** with multiple outputs connected, open Settings → Audio, pick a non-default **Output device**, go live, and confirm the stream carries that device's audio; restart and confirm the choice persisted and re-applied.

---

## Self-Review

**Spec coverage:**
- `desktopDevice` setting + default + persistence → Task 2. ✓
- Shared `listDevicesFor`/`setDeviceFor` + `listDesktopDevices`/`setDesktopDevice` + `applySettings` desktopDevice → Task 1. ✓
- State/IPC/preload (`audio.desktopDevice`, channels, AxiApi, handlers) → Tasks 3, 4, 5. ✓
- UI output dropdown (shown when desktop on, empty message, selection) → Task 6. ✓
- apply-on-boot carries desktopDevice → Task 5. ✓
- Best-effort/non-fatal preserved (helpers keep the swallow) → Task 1. ✓

**Placeholder scan:** No TBD/TODO; every code step has full code.

**Type consistency:** `applySettings` shape `{ desktopEnabled, desktopDevice, micEnabled, micDevice }` is consistent across Task 1 (definition), Task 5 (boot caller), and Task 2/3 (the fields it reads). `AudioDevice` reused everywhere. `desktopDevice` (string|null) consistent across StreamSettings, AppState, handlers, and the `<select value={audio.desktopDevice ?? ''}>` binding. The two channel/method names (`getDesktopDevices`/`setDesktopDevice`) match across state, ipc, preload, handlers, and UI.

**Known intentional cross-task gaps:** Task 1 changes `applySettings`'s shape (index.ts boot caller red) and Tasks 3–4 leave preload/index.ts red until Task 5 — same staged pattern as prior plans, documented per task.
