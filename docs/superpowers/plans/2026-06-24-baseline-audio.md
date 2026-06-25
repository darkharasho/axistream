# Baseline Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add desktop (system) audio plus an optional, default-off microphone to the stream — with desktop & mic mute toggles, a mic device picker, and an opinionated AAC encoder setting — so AxiStream stops streaming silent video.

**Architecture:** The `provisioner` creates two OBS core PulseAudio inputs (`pulse_output_capture` desktop, `pulse_input_capture` mic, created muted) and sets the audio encoder via `SetProfileParameter`. A new `AudioController` (sibling to `StreamController`) drives mute/device/enumeration over obs-websocket. `StreamSettings` persists the three audio prefs; state/IPC/preload expose them; a new `AudioSettings` component renders the toggles + device dropdown. No new runtime dependency.

**Tech Stack:** Electron 31, React 18, TypeScript 5.5, Vitest 2, obs-websocket-js 5, OBS core PulseAudio sources (Linux/flatpak).

## Global Constraints

- **No new runtime dependency.** OBS core sources only; no plugin.
- **Linux target** (flatpak `com.obsproject.Studio` under cage). These source kinds are Linux-only.
- **Exact OBS input kinds:** desktop = `pulse_output_capture`, mic = `pulse_input_capture`.
- **Exact input names (must match across packages, byte-for-byte):**
  - Desktop audio input name: `AxiStream Desktop Audio`
  - Mic input name: `AxiStream Mic`
- **Exact encoder profile params:** `SetProfileParameter` with `('SimpleOutput','ABitrate','160')`, `('Audio','SampleRate','48000')`, `('Audio','ChannelSetup','Stereo')`.
- **obs-websocket call shapes (already used in this repo):**
  - `CreateInput { sceneName, inputName, inputKind, inputSettings }`
  - `SetInputMute { inputName, inputMuted }`
  - `SetInputSettings { inputName, inputSettings, overlay: true }`
  - `GetInputPropertiesListPropertyItems { inputName, propertyName }` → `{ propertyItems: Array<{ itemName: string; itemEnabled: boolean; itemValue: string }> }`
  - `SetProfileParameter { parameterCategory, parameterName, parameterValue }`
  - `GetInputList` → `{ inputs: Array<{ inputName: string }> }`
- **Audio is non-fatal:** any audio provisioning/control failure must be caught and logged, never aborting video provisioning or blocking go-live.
- **Defaults:** `desktopEnabled` = `true`, `micEnabled` = `false`, `micDevice` = `null`.
- **Code style:** 2-space indent, NO semicolons, single quotes, named exports; `node:` prefix on built-ins; `.js` extension on relative imports.
- **Real typecheck** is `cd packages/app && npx tsc --noEmit -p tsconfig.json` (electron-vite `build` does NOT typecheck). Tests: `npm -w @axistream/app run test`, `npm -w @axistream/capture run test`.

---

## File Structure

**New:**
- `packages/app/src/main/AudioController.ts` — runtime audio control over obs-websocket
- `packages/app/test/audio-controller.test.ts`
- `packages/app/src/renderer/components/AudioSettings.tsx` — audio settings UI
- `packages/app/test/audio-settings.test.tsx`

**Modified:**
- `packages/app/src/main/StreamSettings.ts` (+ `packages/app/test/stream-settings.test.ts`)
- `packages/capture/src/provisioner.ts` (+ `packages/capture/test/provisioner.test.ts`)
- `packages/app/src/shared/state.ts`
- `packages/app/test/settings-screen.test.tsx`, `packages/app/test/stream-screen.test.tsx` (fixture: add `audio`)
- `packages/app/src/main/ipc.ts`
- `packages/app/src/preload/index.ts`
- `packages/app/src/main/index.ts`
- `packages/app/src/renderer/components/SettingsScreen.tsx`

---

## Phase 1 — Settings + controller

### Task 1: StreamSettings audio fields

**Files:**
- Modify: `packages/app/src/main/StreamSettings.ts`
- Modify: `packages/app/test/stream-settings.test.ts`

**Interfaces:**
- Produces: `StreamSettingsData` gains `desktopEnabled: boolean`, `micEnabled: boolean`, `micDevice: string | null`; `DEFAULT_SETTINGS` gains `desktopEnabled: true, micEnabled: false, micDevice: null`.

- [ ] **Step 1: Add failing tests**

Append to `packages/app/test/stream-settings.test.ts` (inside the existing `describe`):

```typescript
it('defaults audio fields', () => {
  const s = new StreamSettings(file).load()
  expect(s.desktopEnabled).toBe(true)
  expect(s.micEnabled).toBe(false)
  expect(s.micDevice).toBe(null)
})

it('persists audio fields', () => {
  new StreamSettings(file).patch({ desktopEnabled: false, micEnabled: true, micDevice: 'alsa_input.pci-0000' })
  const r = new StreamSettings(file).load()
  expect(r.desktopEnabled).toBe(false)
  expect(r.micEnabled).toBe(true)
  expect(r.micDevice).toBe('alsa_input.pci-0000')
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npm -w @axistream/app run test -- stream-settings`
Expected: FAIL — `desktopEnabled`/`micEnabled`/`micDevice` undefined.

- [ ] **Step 3: Implement**

In `StreamSettings.ts`, add to `StreamSettingsData`:

```typescript
  desktopEnabled: boolean
  micEnabled: boolean
  micDevice: string | null
```

Add to `DEFAULT_SETTINGS`:

```typescript
  desktopEnabled: true,
  micEnabled: false,
  micDevice: null,
```

Add to the `load()` validated return object (mirroring the existing field validation):

```typescript
    desktopEnabled: typeof raw.desktopEnabled === 'boolean' ? raw.desktopEnabled : DEFAULT_SETTINGS.desktopEnabled,
    micEnabled: typeof raw.micEnabled === 'boolean' ? raw.micEnabled : DEFAULT_SETTINGS.micEnabled,
    micDevice: typeof raw.micDevice === 'string' ? raw.micDevice : null,
```

- [ ] **Step 4: Run to verify pass**

Run: `npm -w @axistream/app run test -- stream-settings`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/StreamSettings.ts packages/app/test/stream-settings.test.ts
git commit -m "feat(settings): persist desktop/mic audio prefs"
```

---

### Task 2: AudioController

**Files:**
- Create: `packages/app/src/main/AudioController.ts`
- Test: `packages/app/test/audio-controller.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface AudioDevice { id: string; name: string }`
  - `interface AudioDeps { client(): { call(req: string, data?: any): Promise<any> } }`
  - `class AudioController` with `setDesktopEnabled(enabled: boolean): Promise<void>`, `setMicEnabled(enabled: boolean): Promise<void>`, `setMicDevice(deviceId: string): Promise<void>`, `listMicDevices(): Promise<AudioDevice[]>`, `applySettings(s: { desktopEnabled: boolean; micEnabled: boolean; micDevice: string | null }): Promise<void>`
  - Exported constants `DESKTOP_AUDIO = 'AxiStream Desktop Audio'`, `MIC = 'AxiStream Mic'`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { AudioController, DESKTOP_AUDIO, MIC } from '../src/main/AudioController.js'

function recorder(responses: Record<string, any> = {}) {
  const calls: { req: string; data: any }[] = []
  const client = () => ({
    call: vi.fn(async (req: string, data?: any) => { calls.push({ req, data }); return responses[req] ?? {} }),
  })
  return { calls, client }
}

describe('AudioController', () => {
  it('setDesktopEnabled mutes/unmutes the desktop input', async () => {
    const r = recorder()
    const a = new AudioController({ client: r.client })
    await a.setDesktopEnabled(false)
    await a.setDesktopEnabled(true)
    expect(r.calls[0]).toEqual({ req: 'SetInputMute', data: { inputName: DESKTOP_AUDIO, inputMuted: true } })
    expect(r.calls[1]).toEqual({ req: 'SetInputMute', data: { inputName: DESKTOP_AUDIO, inputMuted: false } })
  })

  it('setMicEnabled mutes/unmutes the mic input', async () => {
    const r = recorder()
    const a = new AudioController({ client: r.client })
    await a.setMicEnabled(true)
    expect(r.calls[0]).toEqual({ req: 'SetInputMute', data: { inputName: MIC, inputMuted: false } })
  })

  it('setMicDevice sets device_id with overlay', async () => {
    const r = recorder()
    const a = new AudioController({ client: r.client })
    await a.setMicDevice('dev-1')
    expect(r.calls[0]).toEqual({ req: 'SetInputSettings', data: { inputName: MIC, inputSettings: { device_id: 'dev-1' }, overlay: true } })
  })

  it('listMicDevices maps property items to {id,name}', async () => {
    const r = recorder({ GetInputPropertiesListPropertyItems: { propertyItems: [
      { itemName: 'Default', itemEnabled: true, itemValue: 'default' },
      { itemName: 'Yeti', itemEnabled: true, itemValue: 'alsa_input.yeti' },
    ] } })
    const a = new AudioController({ client: r.client })
    expect(await a.listMicDevices()).toEqual([
      { id: 'default', name: 'Default' },
      { id: 'alsa_input.yeti', name: 'Yeti' },
    ])
  })

  it('applySettings sets mic device then desktop+mic mute', async () => {
    const r = recorder()
    const a = new AudioController({ client: r.client })
    await a.applySettings({ desktopEnabled: false, micEnabled: true, micDevice: 'dev-9' })
    const reqs = r.calls.map((c) => c.req)
    expect(reqs).toEqual(['SetInputSettings', 'SetInputMute', 'SetInputMute'])
    expect(r.calls[0].data.inputSettings.device_id).toBe('dev-9')
    expect(r.calls[1].data).toEqual({ inputName: DESKTOP_AUDIO, inputMuted: true })
    expect(r.calls[2].data).toEqual({ inputName: MIC, inputMuted: false })
  })

  it('swallows client errors (never throws out)', async () => {
    const client = () => ({ call: vi.fn(async () => { throw new Error('boom') }) })
    const a = new AudioController({ client })
    await expect(a.setMicEnabled(true)).resolves.toBeUndefined()
    await expect(a.listMicDevices()).resolves.toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npm -w @axistream/app run test -- audio-controller`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
export const DESKTOP_AUDIO = 'AxiStream Desktop Audio'
export const MIC = 'AxiStream Mic'

export interface AudioDevice { id: string; name: string }

export interface AudioDeps {
  client(): { call(req: string, data?: unknown): Promise<any> }
}

export class AudioController {
  constructor(private readonly d: AudioDeps) {}

  private async mute(inputName: string, muted: boolean): Promise<void> {
    try { await this.d.client().call('SetInputMute', { inputName, inputMuted: muted }) }
    catch (e) { console.warn('[audio] SetInputMute failed', e) }
  }

  async setDesktopEnabled(enabled: boolean): Promise<void> { await this.mute(DESKTOP_AUDIO, !enabled) }
  async setMicEnabled(enabled: boolean): Promise<void> { await this.mute(MIC, !enabled) }

  async setMicDevice(deviceId: string): Promise<void> {
    try {
      await this.d.client().call('SetInputSettings', {
        inputName: MIC, inputSettings: { device_id: deviceId }, overlay: true,
      })
    } catch (e) { console.warn('[audio] SetInputSettings failed', e) }
  }

  async listMicDevices(): Promise<AudioDevice[]> {
    try {
      const r = await this.d.client().call('GetInputPropertiesListPropertyItems', {
        inputName: MIC, propertyName: 'device_id',
      })
      return (r.propertyItems ?? []).map((it: { itemName: string; itemValue: string }) => ({
        id: it.itemValue, name: it.itemName,
      }))
    } catch (e) { console.warn('[audio] list devices failed', e); return [] }
  }

  async applySettings(s: { desktopEnabled: boolean; micEnabled: boolean; micDevice: string | null }): Promise<void> {
    if (s.micDevice) await this.setMicDevice(s.micDevice)
    await this.setDesktopEnabled(s.desktopEnabled)
    await this.setMicEnabled(s.micEnabled)
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm -w @axistream/app run test -- audio-controller`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/AudioController.ts packages/app/test/audio-controller.test.ts
git commit -m "feat(audio): AudioController for desktop/mic mute + device select"
```

---

## Phase 2 — Provisioning

### Task 3: Provision audio inputs + encoder

**Files:**
- Modify: `packages/capture/src/provisioner.ts`
- Modify: `packages/capture/test/provisioner.test.ts`

**Interfaces:**
- Consumes: the input-name constants (same literals as `AudioController`).
- Produces: after the video input is created, the scene also has `AxiStream Desktop Audio` (`pulse_output_capture`) and `AxiStream Mic` (`pulse_input_capture`, muted), and the profile has AAC 160/48000/Stereo set. A new private method `provisionAudio(client)` performs this; it is best-effort (never throws out).

- [ ] **Step 1: Read the existing test + add a failing test**

First READ `packages/capture/test/provisioner.test.ts` to match its mock-client/harness style. Then add a test that drives `buildCollection` (or the provision entry the existing tests already call) and asserts the audio calls were issued. Use the existing test's client mock; the assertions to add:

```typescript
it('provisions desktop + muted mic audio inputs and AAC encoder', async () => {
  // Arrange the same way existing buildCollection tests do (mock sidecar/client
  // capturing calls into an array `calls` of { req, data }), then run provision.
  // Assert:
  const created = calls.filter((c) => c.req === 'CreateInput').map((c) => c.data)
  expect(created).toEqual(expect.arrayContaining([
    expect.objectContaining({ inputName: 'AxiStream Desktop Audio', inputKind: 'pulse_output_capture' }),
    expect.objectContaining({ inputName: 'AxiStream Mic', inputKind: 'pulse_input_capture' }),
  ]))
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ req: 'SetInputMute', data: { inputName: 'AxiStream Mic', inputMuted: true } }),
    expect.objectContaining({ req: 'SetProfileParameter', data: { parameterCategory: 'SimpleOutput', parameterName: 'ABitrate', parameterValue: '160' } }),
    expect.objectContaining({ req: 'SetProfileParameter', data: { parameterCategory: 'Audio', parameterName: 'SampleRate', parameterValue: '48000' } }),
    expect.objectContaining({ req: 'SetProfileParameter', data: { parameterCategory: 'Audio', parameterName: 'ChannelSetup', parameterValue: 'Stereo' } }),
  ]))
})
```

If the existing harness records calls differently (e.g. a `vi.fn` whose `mock.calls` you inspect), adapt the assertions to that shape — the **behavior** asserted (two CreateInputs with those kinds, the mic mute, the three profile params) is what matters.

- [ ] **Step 2: Run to verify fail**

Run: `npm -w @axistream/capture run test -- provisioner`
Expected: FAIL — audio calls not issued.

- [ ] **Step 3: Implement**

Add constants near the existing ones in `provisioner.ts`:

```typescript
const DESKTOP_AUDIO = 'AxiStream Desktop Audio'
const MIC = 'AxiStream Mic'
const DESKTOP_KIND = 'pulse_output_capture'
const MIC_KIND = 'pulse_input_capture'
```

Add a private method:

```typescript
  // Best-effort: create desktop + mic audio inputs and set the AAC encoder.
  // Never throws — silent audio must not abort (video) provisioning.
  private async provisionAudio(client: ProvisionerSidecar['client'] extends () => infer C ? C : never): Promise<void> {
    try {
      const { inputs } = await client.call('GetInputList')
      const have = new Set((inputs ?? []).map((i: { inputName: string }) => i.inputName))
      if (!have.has(DESKTOP_AUDIO)) {
        await client.call('CreateInput', { sceneName: SCENE, inputName: DESKTOP_AUDIO, inputKind: DESKTOP_KIND, inputSettings: {} })
      }
      if (!have.has(MIC)) {
        await client.call('CreateInput', { sceneName: SCENE, inputName: MIC, inputKind: MIC_KIND, inputSettings: { device_id: 'default' } })
        await client.call('SetInputMute', { inputName: MIC, inputMuted: true })
      }
      await client.call('SetProfileParameter', { parameterCategory: 'SimpleOutput', parameterName: 'ABitrate', parameterValue: '160' })
      await client.call('SetProfileParameter', { parameterCategory: 'Audio', parameterName: 'SampleRate', parameterValue: '48000' })
      await client.call('SetProfileParameter', { parameterCategory: 'Audio', parameterName: 'ChannelSetup', parameterValue: 'Stereo' })
    } catch (e) {
      console.warn('[provision] audio setup failed (continuing without audio)', e)
    }
  }
```

(If the inferred-type generic for the `client` parameter is awkward in this codebase, type the parameter as `{ call(req: string, data?: any): Promise<any> }` instead — match how `buildCollection` already refers to the client.)

Call it at the end of `buildCollection`, after the video `CreateInput`, using the same `client` reference already in scope:

```typescript
    await this.provisionAudio(client)
```

- [ ] **Step 4: Run to verify pass**

Run: `npm -w @axistream/capture run test -- provisioner`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/capture/src/provisioner.ts packages/capture/test/provisioner.test.ts
git commit -m "feat(provision): add desktop+mic audio inputs and AAC encoder"
```

---

## Phase 3 — Wiring (state, IPC, main)

### Task 4: Shared state, channels, AxiApi + fixture fixes

**Files:**
- Modify: `packages/app/src/shared/state.ts`
- Modify: `packages/app/test/settings-screen.test.tsx`
- Modify: `packages/app/test/stream-screen.test.tsx`

**Interfaces:**
- Produces:
  - `interface AudioDevice { id: string; name: string }` (exported from `state.ts`)
  - `AppState.audio: { desktopEnabled: boolean; micEnabled: boolean; micDevice: string | null }`
  - `INITIAL_STATE.audio = { desktopEnabled: true, micEnabled: false, micDevice: null }`
  - `CH` gains `getAudioDevices`, `setDesktopEnabled`, `setMicEnabled`, `setMicDevice`
  - `AxiApi` gains `getAudioDevices(): Promise<AudioDevice[]>`, `setDesktopEnabled(enabled: boolean): Promise<void>`, `setMicEnabled(enabled: boolean): Promise<void>`, `setMicDevice(deviceId: string): Promise<void>`

- [ ] **Step 1: Edit `state.ts`**

Add the type (near other exported interfaces):

```typescript
export interface AudioDevice { id: string; name: string }
```

Add to `AppState`:

```typescript
  audio: { desktopEnabled: boolean; micEnabled: boolean; micDevice: string | null }
```

Add to `INITIAL_STATE`:

```typescript
  audio: { desktopEnabled: true, micEnabled: false, micDevice: null },
```

Add to `CH` (before `} as const`):

```typescript
  getAudioDevices: 'axi:getAudioDevices',
  setDesktopEnabled: 'axi:setDesktopEnabled',
  setMicEnabled: 'axi:setMicEnabled',
  setMicDevice: 'axi:setMicDevice',
```

Add to `AxiApi` (with the other invokable methods):

```typescript
  getAudioDevices: () => Promise<AudioDevice[]>
  setDesktopEnabled: (enabled: boolean) => Promise<void>
  setMicEnabled: (enabled: boolean) => Promise<void>
  setMicDevice: (deviceId: string) => Promise<void>
```

- [ ] **Step 2: Fix existing AppState fixtures**

In BOTH `packages/app/test/settings-screen.test.tsx` and `packages/app/test/stream-screen.test.tsx`, find the `AppState` literal(s) used as `base`/fixtures and add the `audio` field so they still satisfy the type:

```typescript
  audio: { desktopEnabled: true, micEnabled: false, micDevice: null },
```

- [ ] **Step 3: Verify tests still pass + scope the typecheck gap**

Run: `npm -w @axistream/app run test -- settings-screen stream-screen`
Expected: PASS (fixtures now complete).

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: the ONLY remaining errors are in `src/main/index.ts` (its `handlers` object doesn't implement the 4 new `IpcHandlers` methods yet — added in Task 6) and in `src/preload/index.ts` / `src/main/ipc.ts` (new `CH`/`AxiApi` members not yet wired — Task 5). No errors in `state.ts` or the two test files. This staged gap is expected; do NOT fix consumers here.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/test/settings-screen.test.tsx packages/app/test/stream-screen.test.tsx
git commit -m "feat(state): audio field, channels, and AxiApi methods"
```

---

### Task 5: IPC handlers + preload API

**Files:**
- Modify: `packages/app/src/main/ipc.ts`
- Modify: `packages/app/src/preload/index.ts`

**Interfaces:**
- Consumes: `CH` + `AxiApi` additions + `AudioDevice` from Task 4.
- Produces: `IpcHandlers` gains the four methods; `registerIpc` registers them; preload `api` forwards them.

- [ ] **Step 1: Extend `ipc.ts`**

Import `AudioDevice` from `../shared/state.js`. Add to `IpcHandlers`:

```typescript
  getAudioDevices(): Promise<AudioDevice[]>
  setDesktopEnabled(enabled: boolean): Promise<void>
  setMicEnabled(enabled: boolean): Promise<void>
  setMicDevice(deviceId: string): Promise<void>
```

Add to `registerIpc`:

```typescript
  ipcMain.handle(CH.getAudioDevices, () => handlers.getAudioDevices())
  ipcMain.handle(CH.setDesktopEnabled, (_e: unknown, enabled: boolean) => handlers.setDesktopEnabled(enabled))
  ipcMain.handle(CH.setMicEnabled, (_e: unknown, enabled: boolean) => handlers.setMicEnabled(enabled))
  ipcMain.handle(CH.setMicDevice, (_e: unknown, deviceId: string) => handlers.setMicDevice(deviceId))
```

- [ ] **Step 2: Extend `preload/index.ts`**

Add to the `api` object (matching the existing `ipcRenderer.invoke` cast style):

```typescript
  getAudioDevices: () => ipcRenderer.invoke(CH.getAudioDevices) as Promise<import('../shared/state.js').AudioDevice[]>,
  setDesktopEnabled: (enabled) => ipcRenderer.invoke(CH.setDesktopEnabled, enabled) as Promise<void>,
  setMicEnabled: (enabled) => ipcRenderer.invoke(CH.setMicEnabled, enabled) as Promise<void>,
  setMicDevice: (deviceId) => ipcRenderer.invoke(CH.setMicDevice, deviceId) as Promise<void>,
```

(If preload already imports types at the top, use a top import for `AudioDevice` instead of the inline `import('...')`.)

- [ ] **Step 3: Typecheck (expect only index.ts gap)**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: remaining errors ONLY in `src/main/index.ts` (handlers object missing the 4 methods — Task 6). None in `ipc.ts` or `preload/index.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main/ipc.ts packages/app/src/preload/index.ts
git commit -m "feat(ipc): audio device + mute/device channels"
```

---

### Task 6: Main wiring

**Files:**
- Modify: `packages/app/src/main/index.ts`

**Interfaces:**
- Consumes: `AudioController` (Task 2), `StreamSettings` audio fields (Task 1), `CH`/`AppState.audio` (Task 4), `IpcHandlers` (Task 5).
- Produces: a constructed `audio` controller; four new handlers; `getInitialState` includes `audio`; `applySettings` invoked after provisioning.

- [ ] **Step 1: Construct the controller**

Near where `StreamController` is constructed (it already has `client: () => sidecar.client()`), add:

```typescript
import { AudioController } from './AudioController.js'
// ...
const audio = new AudioController({ client: () => sidecar.client() })
```

- [ ] **Step 2: Include audio in `getInitialState`**

Ensure the object returned by `getInitialState` carries `audio`. If it spreads `state` (which derives from `INITIAL_STATE`), audio is already present — confirm it is in the returned shape. If it builds an explicit literal, add:

```typescript
  audio: state.audio,
```

- [ ] **Step 3: Implement the four handlers**

In the `handlers` object, add (each persists, drives OBS, and pushes state):

```typescript
  getAudioDevices: () => audio.listMicDevices(),
  setDesktopEnabled: async (enabled: boolean) => {
    settings.patch({ desktopEnabled: enabled })
    await audio.setDesktopEnabled(enabled)
    setState({ audio: { ...state.audio, desktopEnabled: enabled } })
  },
  setMicEnabled: async (enabled: boolean) => {
    settings.patch({ micEnabled: enabled })
    await audio.setMicEnabled(enabled)
    setState({ audio: { ...state.audio, micEnabled: enabled } })
  },
  setMicDevice: async (deviceId: string) => {
    settings.patch({ micDevice: deviceId })
    await audio.setMicDevice(deviceId)
    setState({ audio: { ...state.audio, micDevice: deviceId } })
  },
```

- [ ] **Step 4: Apply persisted audio after provisioning + seed state**

Where the app reaches READY after provisioning (after `capture.provision()` / boot completes — the same place virtual cam is started), apply persisted prefs and seed the audio slice of state:

```typescript
  const a = settings.load()
  setState({ audio: { desktopEnabled: a.desktopEnabled, micEnabled: a.micEnabled, micDevice: a.micDevice } })
  await audio.applySettings({ desktopEnabled: a.desktopEnabled, micEnabled: a.micEnabled, micDevice: a.micDevice })
```

(Best-effort — `applySettings` already swallows errors.)

- [ ] **Step 5: Full typecheck + tests green**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` → ZERO errors.
Run: `npm -w @axistream/app run test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/main/index.ts
git commit -m "feat(main): wire audio controller, handlers, and apply-on-boot"
```

---

## Phase 4 — UI

### Task 7: AudioSettings component

**Files:**
- Create: `packages/app/src/renderer/components/AudioSettings.tsx`
- Test: `packages/app/test/audio-settings.test.tsx`
- Modify: `packages/app/src/renderer/components/SettingsScreen.tsx`
- Modify: `packages/app/test/settings-screen.test.tsx` (stub new axi methods)

**Interfaces:**
- Consumes: `axi.getAudioDevices/setDesktopEnabled/setMicEnabled/setMicDevice`, `state.audio`.
- Produces: `<AudioSettings audio={state.audio} />` mounted in `SettingsScreen`.

- [ ] **Step 1: Write the render test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AudioSettings } from '../src/renderer/components/AudioSettings.js'

const axi = {
  getAudioDevices: vi.fn(async () => [{ id: 'default', name: 'Default' }, { id: 'yeti', name: 'Yeti' }]),
  setDesktopEnabled: vi.fn(async () => {}),
  setMicEnabled: vi.fn(async () => {}),
  setMicDevice: vi.fn(async () => {}),
}
beforeEach(() => { (globalThis as any).axi = axi; vi.clearAllMocks() })

describe('AudioSettings', () => {
  it('toggles desktop audio', () => {
    render(<AudioSettings audio={{ desktopEnabled: true, micEnabled: false, micDevice: null }} />)
    fireEvent.click(screen.getByLabelText(/desktop audio/i))
    expect(axi.setDesktopEnabled).toHaveBeenCalledWith(false)
  })

  it('toggles mic and shows a populated device picker', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, micEnabled: true, micDevice: null }} />)
    expect(axi.getAudioDevices).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('option', { name: 'Yeti' })).toBeInTheDocument())
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'yeti' } })
    expect(axi.setMicDevice).toHaveBeenCalledWith('yeti')
  })

  it('does not query devices when mic is off', () => {
    render(<AudioSettings audio={{ desktopEnabled: true, micEnabled: false, micDevice: null }} />)
    expect(axi.getAudioDevices).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npm -w @axistream/app run test -- audio-settings`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `AudioSettings.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { AxiApi, AudioDevice, AppState } from '../../shared/state.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi

export function AudioSettings({ audio }: { audio: AppState['audio'] }) {
  const [devices, setDevices] = useState<AudioDevice[]>([])

  useEffect(() => {
    if (!audio.micEnabled) return
    axi().getAudioDevices().then(setDevices)
  }, [audio.micEnabled])

  return (
    <section className="yt-settings">
      <h3>Audio</h3>

      <label className="audio-row">
        <input type="checkbox" checked={audio.desktopEnabled} aria-label="Desktop audio"
          onChange={(e) => axi().setDesktopEnabled(e.target.checked)} />
        <span>Desktop audio</span>
      </label>

      <label className="audio-row">
        <input type="checkbox" checked={audio.micEnabled} aria-label="Microphone"
          onChange={(e) => axi().setMicEnabled(e.target.checked)} />
        <span>Microphone</span>
      </label>

      {audio.micEnabled && (
        <label>Microphone device
          <select value={audio.micDevice ?? ''} onChange={(e) => axi().setMicDevice(e.target.value)}>
            {devices.length === 0 && <option value="">No input devices found</option>}
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Add minimal CSS**

In `packages/app/src/renderer/styles.css`, add near the `.yt-settings` block:

```css
.audio-row { flex-direction: row !important; align-items: center; gap: 8px; cursor: pointer; }
.audio-row input { width: auto; }
```

- [ ] **Step 5: Mount in SettingsScreen + stub in its test**

In `SettingsScreen.tsx`, import `AudioSettings` and render `<AudioSettings audio={state.audio} />` (place it near `<YouTubeSettings .../>`).

In `packages/app/test/settings-screen.test.tsx`, add the audio methods to the mocked `axi` object so the mounted component doesn't throw:

```typescript
  getAudioDevices: vi.fn(async () => []),
  setDesktopEnabled: vi.fn(async () => {}),
  setMicEnabled: vi.fn(async () => {}),
  setMicDevice: vi.fn(async () => {}),
```

- [ ] **Step 6: Run tests + full typecheck**

Run: `npm -w @axistream/app run test -- audio-settings settings-screen` → PASS.
Run: `npm -w @axistream/app run test` → all pass.
Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json` → ZERO errors.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/renderer/components/AudioSettings.tsx packages/app/test/audio-settings.test.tsx packages/app/src/renderer/components/SettingsScreen.tsx packages/app/test/settings-screen.test.tsx packages/app/src/renderer/styles.css
git commit -m "feat(ui): audio settings — desktop/mic toggles + device picker"
```

---

## Final verification

- [ ] **Full suites:** `npm -w @axistream/app run test` and `npm -w @axistream/capture run test` — all green.
- [ ] **Typecheck:** `cd packages/app && npx tsc --noEmit -p tsconfig.json` — zero errors.
- [ ] **Manual smoke (the headless-audio risk + real source-kind verification):**
  1. `npm run dev`, let it provision, go live to a test broadcast.
  2. Confirm **desktop audio is audible** on the YouTube watch page (proves `pulse_output_capture` works headless under cage — if the source kind name is wrong for this OBS build, provisioning logs `[provision] audio setup failed`; fix the kind constant and retry).
  3. In Settings → Audio, toggle **Desktop audio** off/on and confirm the stream mutes/unmutes.
  4. Toggle **Microphone** on, pick a device, confirm it mixes into the stream.
  5. Restart the app and confirm the toggles/device persist and are re-applied.

---

## Self-Review

**Spec coverage:**
- Desktop audio + muted mic provisioning + AAC encoder → Task 3. ✓
- Desktop & mic mute toggles, mic device select, device enumeration, applySettings → Task 2 (`AudioController`) + Task 6 (wiring). ✓
- `desktopEnabled`/`micEnabled`/`micDevice` persistence + defaults → Task 1. ✓
- State/IPC/preload exposure (`audio`, channels, `AxiApi`, `AudioDevice`) → Tasks 4, 5. ✓
- UI: desktop toggle, mic toggle (default off), device dropdown, empty-list message → Task 7. ✓
- Non-fatal audio failures → Task 3 (`provisionAudio` try/catch) + Task 2 (controller swallows). ✓
- apply-persisted-on-boot → Task 6 Step 4. ✓
- Manual smoke for headless-audio risk + real source-kind verification → Final verification. ✓

**Placeholder scan:** No TBD/TODO. Task 3's test is given as concrete assertions to integrate with the existing `provisioner.test.ts` harness (whose exact mock shape isn't reproduced here) — the asserted behavior and call shapes are fully specified; the implementer adapts them to the file's existing mock style, which is a legitimate "match the existing pattern" instruction, not a placeholder.

**Type consistency:** `AudioDevice { id, name }` defined in both `AudioController.ts` (Task 2) and `state.ts` (Task 4) with identical shape, flowing through `getAudioDevices`. Input-name constants `AxiStream Desktop Audio` / `AxiStream Mic` are identical literals in `AudioController.ts` (Task 2) and `provisioner.ts` (Task 3), enforced by Global Constraints. `audio` slice shape `{ desktopEnabled, micEnabled, micDevice }` is consistent across `StreamSettings` (Task 1), `AppState` (Task 4), handlers (Task 6), and `AudioSettings` props (Task 7). The four method names/signatures match across `AudioController`, `IpcHandlers`, `AxiApi`, preload, and handlers.

**Known intentional cross-task gaps:** Tasks 4–5 leave `tsc` red in `index.ts` until Task 6 implements the four handlers (documented in each task). Same staging pattern as the OAuth plan.
