# Baseline Audio (Desktop + Optional Mic) — Design

**Date:** 2026-06-24
**Status:** Approved (design); pending implementation plan
**Scope:** Sub-project A of audio support. Per-application capture is **spec B** (follow-up), designed-for here but not built.

## Problem

AxiStream currently streams **silent video**. The provisioner creates a single
video capture input (`provisioner.ts` `buildCollection`) and nothing else — no
desktop audio, no mic, and no audio encoder configuration. `StreamController`
only sets the RTMPS server/key. On the headless Linux/cage setup there is no
audio source wired into OBS at all, so the YouTube stream has no sound.

This spec adds **baseline audio**: desktop/system audio (always on) plus an
**optional microphone** (default off), with an opinionated AAC encoder setting.

## Platform & non-goals

- **Target: Linux** (where AxiStream runs today — flatpak `com.obsproject.Studio`
  under cage). Uses OBS **core** PulseAudio sources; no plugin required.
- **Non-goals:** per-application audio capture (spec B); per-source volume
  faders / audio meters UI; audio monitoring; Windows/macOS audio wiring; video
  encoder presets (separate task). Mic is a single device; no multi-mic mixing.

## Feasibility notes (verified during design)

- OBS is launched as `flatpak run com.obsproject.Studio` with no audio sockets
  stripped; the OBS flatpak ships PulseAudio/PipeWire access by default, and
  `XDG_RUNTIME_DIR` is inherited, so the headless instance can reach the user's
  audio server.
- OBS core on Linux provides input kinds `pulse_output_capture` (desktop /
  monitor of default sink) and `pulse_input_capture` (microphone) — no plugin.
- Audio encoder settings live in the profile config and are settable over
  obs-websocket via `SetProfileParameter`.

## Architecture

The existing OBS-over-websocket pipeline is extended; no new runtime dependency.

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `provisioner` (modified) | Create the two audio inputs; set the AAC encoder params; idempotent | obs-websocket `CreateInput`, `SetInputMute`, `SetProfileParameter`, `GetInputList` |
| `AudioController` (new) | Runtime mic control: enable/mute, device select, list devices, re-apply persisted state | obs-websocket client |
| `StreamSettings` (modified) | Persist `micEnabled`, `micDevice` | userData JSON |
| IPC / preload / state (modified) | Expose audio device list + mic controls to the renderer | existing `CH`/`AxiApi` patterns |
| `AudioSettings.tsx` (new) | Audio settings UI: desktop-on indicator, mic toggle, device dropdown | renderer store + `axi` bridge |

### Constants

- `DESKTOP_AUDIO = 'AxiStream Desktop Audio'`
- `MIC = 'AxiStream Mic'`
- `AUDIO_BITRATE = 160` (kbps), sample rate `48000`, channel setup `Stereo`

## Provisioning changes

In `provisioner.ts`, after the existing video-capture input is created (and
guarded by the same "skip if already present" check that the video source uses,
via `GetInputList`):

1. **Desktop audio** — `CreateInput { sceneName, inputName: DESKTOP_AUDIO,
   inputKind: 'pulse_output_capture', inputSettings: {} }`. Empty settings =
   default output device's monitor. Left unmuted.
2. **Mic** — `CreateInput { sceneName, inputName: MIC, inputKind:
   'pulse_input_capture', inputSettings: { device_id: 'default' } }`, then
   `SetInputMute { inputName: MIC, inputMuted: true }`. Created muted so the
   baseline never streams room noise until the user opts in.
3. **Encoder** — `SetProfileParameter` calls:
   - `('SimpleOutput', 'ABitrate', '160')`
   - `('Audio', 'SampleRate', '48000')`
   - `('Audio', 'ChannelSetup', 'Stereo')`

All audio steps are **best-effort**: wrapped so a failure (e.g. no audio server)
logs a warning and lets provisioning continue — video must still stream. The
inputs route to mix track 1 by default, which is what the streaming output uses.

## AudioController (new)

`packages/app/src/main/AudioController.ts`

Interface (consumed by `index.ts` handlers):

- `interface AudioDevice { id: string; name: string }`
- `interface AudioDeps { client(): { call(req: string, data?: any): Promise<any> } }`
- `class AudioController`:
  - `setMicEnabled(enabled: boolean): Promise<void>` → `SetInputMute { inputName: MIC, inputMuted: !enabled }`
  - `setMicDevice(deviceId: string): Promise<void>` → `SetInputSettings { inputName: MIC, inputSettings: { device_id: deviceId }, overlay: true }`
  - `listMicDevices(): Promise<AudioDevice[]>` → `GetInputPropertiesListPropertyItems { inputName: MIC, propertyName: 'device_id' }`, mapping each item to `{ id: itemValue, name: itemName }`
  - `applySettings(s: { micEnabled: boolean; micDevice: string | null }): Promise<void>` → set device if present, then mute state; best-effort. Called after provisioning / OBS restart so OBS reflects persisted prefs.

All methods wrap obs-websocket calls in try/catch and never throw out (failures
are logged; the UI degrades, not crashes).

## StreamSettings changes

Add to `StreamSettingsData` (and `DEFAULT_SETTINGS`, and `load()` validation):

- `micEnabled: boolean` — default `false`
- `micDevice: string | null` — default `null` (OBS default device)

Validation mirrors existing fields (type-check, fall back to default).

## State / IPC / preload

- `AppState.audio: { micEnabled: boolean; micDevice: string | null }`; included
  in `INITIAL_STATE` (`{ micEnabled: false, micDevice: null }`) and
  `getInitialState`. Device list is **not** in state — fetched on demand.
- New `CH` channels: `getAudioDevices`, `setMicEnabled`, `setMicDevice`.
- `IpcHandlers` / `AxiApi`:
  - `getAudioDevices(): Promise<AudioDevice[]>`
  - `setMicEnabled(enabled: boolean): Promise<void>`
  - `setMicDevice(deviceId: string): Promise<void>`
- `index.ts` handlers: call `AudioController`, persist via `StreamSettings.patch`,
  and `setState({ audio: { micEnabled, micDevice } })`.
- On startup (after provision + clean profile), call
  `audio.applySettings(settings.load())`.

## UI — AudioSettings.tsx

Mounted in `SettingsScreen` (near `YouTubeSettings`), themed consistently
(`.btn`, existing form styles):

- Heading "Audio".
- **Desktop audio:** a static line — "Desktop audio: On" (always captured in
  baseline; no toggle for v1).
- **Microphone:** a toggle bound to `state.audio.micEnabled` (default off). When
  on, reveal a `<select>` populated from `axi.getAudioDevices()` bound to
  `state.audio.micDevice`; changing it calls `setMicDevice`. Toggling calls
  `setMicEnabled`.
- Empty device list → show "No input devices found."

## Data flow

1. **Provision:** video + desktop-audio + muted-mic inputs created; AAC 160 k /
   48 k / stereo set.
2. **Startup:** `applySettings` re-asserts persisted mic enable/device.
3. **Go live:** track-1 audio (desktop always; mic per mute) encodes as AAC and
   streams — desktop audio audible immediately.
4. **Toggle mic on:** `setMicEnabled(true)` → unmute MIC + persist + `setState`.
5. **Pick device:** `setMicDevice(id)` → `SetInputSettings` + persist + `setState`.

## Error handling

- Audio input creation fails → log warning, continue provisioning (non-fatal).
- `SetProfileParameter` fails / unsupported → best-effort, logged.
- `listMicDevices` fails → return `[]`; UI shows "No input devices found."
- All `AudioController` calls best-effort; surfaced as a settings-level warning,
  never a crash or a blocked go-live.

## Testing

- **`AudioController`** (mock client): `setMicEnabled(true/false)` issues
  `SetInputMute` with the correct `inputMuted`; `setMicDevice` issues
  `SetInputSettings` with `device_id`; `listMicDevices` maps property items to
  `{id,name}`; `applySettings` applies device then mute; a throwing client is
  swallowed (no throw out).
- **`StreamSettings`**: `micEnabled`/`micDevice` defaults + persist + corrupt-file
  fallback (extend existing suite).
- **`provisioner`**: asserts both audio `CreateInput`s, the mic `SetInputMute`,
  and the three `SetProfileParameter`s are issued; idempotent skip when inputs
  already exist; audio-failure path doesn't abort video provisioning.
- **`AudioSettings`** (render): mic toggle calls `setMicEnabled`; when enabled,
  dropdown populates from `getAudioDevices` and selection calls `setMicDevice`.
- **Manual smoke (the headless-audio risk):** run a real stream and confirm
  desktop audio is audible on YouTube, then enable mic and confirm it mixes in.

## Seam for per-app audio (spec B, not built here)

`AudioController` manages named inputs generically. Spec B will:
- ensure the `obs-pipewire-audio-capture` flatpak plugin is installed,
- add an `AxiStream Game Audio` input of kind
  `pipewire_audio_capture_application` bound to GW2's PipeWire node,
- add an audio-mode toggle ("All desktop audio" vs "Game only") that mutes /
  unmutes desktop vs game inputs.

No changes here block that; the input-management surface already supports it.
