# Desktop Audio Output Device Picker — Design

**Date:** 2026-06-24
**Status:** Approved (design); pending implementation plan
**Scope:** A device picker for the desktop (output) audio source, mirroring the
mic input picker that baseline audio already shipped.

## Problem

Baseline audio gave the **mic** a device dropdown, but **desktop audio** is
hardwired to the default output device's monitor (`pulse_output_capture` created
with empty settings). Users with multiple outputs (HDMI, USB DAC, headset) can't
choose *which* playback device's audio to stream. This adds an output-device
picker so desktop audio is an explicit, selectable source like the mic.

Enumeration now works end-to-end (the `ensureAudioInputs` boot fix means the
`AxiStream Desktop Audio` input reliably exists, and OBS lists the output
monitors via `GetInputPropertiesListPropertyItems`).

## Non-goals

Per-app audio (spec B); per-source volume/meters; multiple simultaneous desktop
captures; Windows/macOS. One desktop source, one selectable device.

## Architecture

A direct mirror of the mic picker. The `AudioController`'s device logic is
refactored into shared private helpers so mic and desktop share one path (and
spec B's per-app source reuses them).

| Unit | Change |
|------|--------|
| `StreamSettings` | add `desktopDevice: string \| null` (default `null` = OBS default) |
| `AudioController` | private `listDevicesFor(inputName)` / `setDeviceFor(inputName, id)`; `setMicDevice`/`listMicDevices` become thin callers; add `setDesktopDevice(id)` / `listDesktopDevices()`; `applySettings` also applies `desktopDevice` |
| state / IPC / preload | `AppState.audio.desktopDevice`; channels `getDesktopDevices` + `setDesktopDevice`; matching `AxiApi` + `IpcHandlers` methods |
| `AudioSettings.tsx` | output device dropdown under the desktop toggle |
| `index.ts` | `setDesktopDevice` handler (persist + drive OBS + setState); `applySettings` call already carries the audio slice |

### Constants

Reuse `DESKTOP_AUDIO = 'AxiStream Desktop Audio'` and `MIC = 'AxiStream Mic'`
already exported from `AudioController`.

## AudioController changes

```
private async listDevicesFor(inputName: string): Promise<AudioDevice[]>
  → GetInputPropertiesListPropertyItems { inputName, propertyName: 'device_id' }
    mapped to { id: itemValue, name: itemName }; [] on error.

private async setDeviceFor(inputName: string, deviceId: string): Promise<void>
  → SetInputSettings { inputName, inputSettings: { device_id: deviceId }, overlay: true }; swallow on error.

listMicDevices()      = listDevicesFor(MIC)
setMicDevice(id)      = setDeviceFor(MIC, id)
listDesktopDevices()  = listDevicesFor(DESKTOP_AUDIO)
setDesktopDevice(id)  = setDeviceFor(DESKTOP_AUDIO, id)

applySettings(s: { desktopEnabled; desktopDevice; micEnabled; micDevice }):
  if (s.desktopDevice) await setDesktopDevice(s.desktopDevice)
  if (s.micDevice)     await setMicDevice(s.micDevice)
  await setDesktopEnabled(s.desktopEnabled)
  await setMicEnabled(s.micEnabled)
```

All calls remain best-effort (swallow + log; never throw out).

## StreamSettings

Add `desktopDevice: string | null` (default `null`) to `StreamSettingsData`,
`DEFAULT_SETTINGS`, and `load()` validation (string-or-null, mirroring
`micDevice`).

## State / IPC / preload

- `AppState.audio` gains `desktopDevice: string | null`; `INITIAL_STATE.audio.desktopDevice = null`.
- `CH`: `getDesktopDevices: 'axi:getDesktopDevices'`, `setDesktopDevice: 'axi:setDesktopDevice'`.
- `IpcHandlers` / `AxiApi`: `getDesktopDevices(): Promise<AudioDevice[]>`, `setDesktopDevice(deviceId: string): Promise<void>`.
- `index.ts` handlers:
  - `getDesktopDevices: () => audio.listDesktopDevices()`
  - `setDesktopDevice: async (deviceId) => { settings.patch({ desktopDevice: deviceId }); await audio.setDesktopDevice(deviceId); setState({ audio: { ...state.audio, desktopDevice: deviceId } }) }`
- The boot `applySettings` call passes `desktopDevice` (loaded from settings) along with the rest of the audio slice.

## UI — AudioSettings.tsx

Under the existing desktop-audio toggle, when `audio.desktopEnabled` is true,
render an output device dropdown (mirroring the mic block):

- A `useEffect` keyed on `audio.desktopEnabled` calls `axi.getDesktopDevices()` →
  local `outputDevices` state (only fetched when desktop is on).
- `<select value={audio.desktopDevice ?? ''} onChange={e => axi.setDesktopDevice(e.target.value)}>`;
  empty list → `<option value="">No output devices found</option>`.
- Labeled "Output device" so it reads as the desktop pair to the mic's
  "Microphone device".

## Data flow

Pick output → `setDesktopDevice(id)` → `SetInputSettings` on `AxiStream Desktop
Audio` + persist + `setState`. On boot, `applySettings` re-applies the persisted
device. Identical lifecycle to the mic picker.

## Error handling

`listDesktopDevices` failure → `[]` → "No output devices found". `setDesktopDevice`
failure → swallowed/logged. Never fatal; never blocks go-live.

## Testing

- **`AudioController`**: `listDevicesFor`/`setDeviceFor` shared helpers used by
  both mic and desktop; `setDesktopDevice` issues `SetInputSettings` on
  `DESKTOP_AUDIO` with `device_id`; `listDesktopDevices` maps items; `setMicDevice`/
  `listMicDevices` still behave as before (regression); `applySettings` applies
  desktop device then mic device then the two mutes; throwing client swallowed.
- **`StreamSettings`**: `desktopDevice` default + persist + corrupt-file fallback.
- **`AudioSettings`** (render): desktop-on populates the output dropdown from
  `getDesktopDevices` and selection calls `setDesktopDevice`; desktop-off does not
  query output devices.
- **Manual smoke:** with multiple outputs, pick a non-default output and confirm
  the stream carries that device's audio.

## Seam for per-app audio (spec B)

`listDevicesFor`/`setDeviceFor` are input-name-generic, so spec B's
`AxiStream Game Audio` source reuses them directly for its device/binding.
