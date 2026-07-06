# GW2 Encoder Presets + Hardware Encode with Software Fallback — Design

**Date:** 2026-07-06
**Status:** Approved (design); pending implementation plan
**Scope:** Opinionated encoder/bitrate configuration for YouTube: pick a
hardware encoder when the machine has one, tune bitrate to the output
resolution/fps, fall back to x264 automatically, and stop lying about the
encoder in the stats chip. Named in the project brief ("hardware-encodes
with software fallback… opinionated GW2 encoder/bitrate presets").

## Problem

AxiStream never touches OBS's output settings. Streams go out with whatever
the fresh `AxiStream` profile defaults to (x264 veryfast at ~2.5 Mbps) — far
too low for a motion-heavy MMO at 1440p60, and CPU-encoded even on machines
with NVENC/VAAPI. `StreamController.mapStats` hardcodes `encoder: 'x264'`.
The app's pitch is that users never open OBS, so AxiStream must own these
settings.

## Non-goals

User-facing quality knobs (opinionated means no settings UI beyond what
exists); AV1/HEVC (YouTube RTMPS ingest is H.264); recording settings;
Advanced output mode (its encoder settings live in `streamEncoder.json`,
which obs-websocket cannot write); Windows/macOS probing (the preset table
and Simple-mode keys are cross-platform; detection returns x264 off-Linux
for now); audio settings beyond bitrate.

## Approaches considered

1. **Simple-output profile parameters over obs-websocket (chosen).**
   `SetProfileParameter` on the `AxiStream` profile: `Output/Mode=Simple`,
   `SimpleOutput/StreamEncoder`, `SimpleOutput/VBitrate`,
   `SimpleOutput/ABitrate`. All Simple-mode settings live in the profile's
   `basic.ini`, fully reachable over the socket; settings apply at the next
   `StartStream`. Crucially, OBS validates `StreamEncoder` availability when
   loading Simple output and silently falls back to x264 — so a wrong
   detection degrades safely.
2. **Advanced output mode.** Explicit encoder IDs and full rate control, but
   encoder settings persist in `streamEncoder.json`, not `basic.ini` —
   unreachable via websocket. Rejected.
3. **No detection, try-hardware-then-fallback only.** Simpler, but the first
   go-live on non-NVIDIA machines always burns a 15 s failed start, and it
   does nothing about bitrate. Rejected as the primary mechanism; a runtime
   fallback still exists as the second line of defense (below).

## Architecture

| Unit | Responsibility |
|------|----------------|
| `encoder-presets.ts` (new, capture pkg) | pure: detection input → simple-mode encoder key; (height, fps) → bitrate preset |
| `detect-encoders.ts` (new, capture pkg) | probe for hardware (injectable fs/platform): NVENC via `/dev/nvidiactl`\|\|`/dev/nvidia0`, VAAPI via `/dev/dri/renderD*` |
| `apply-encoder-settings.ts` (new, capture pkg) | write the chosen preset to the profile via `SetProfileParameter`; best-effort |
| `StreamController` | optional one-shot software-fallback retry on failed start; dynamic encoder label in stats |
| `StreamSettings` | persist `preferSoftware: boolean` (set after a hardware start failure) |
| `index.ts` | detect once at boot, apply after every `applyResolution` (bitrate depends on output size), wire the fallback |
| `StatChips` / state | no schema change — `LiveStats.encoder` already exists; it just becomes truthful |

### encoder-presets.ts (pure)

```ts
export type EncoderKind = 'nvenc' | 'vaapi' | 'x264'
export interface EncoderPreset {
  streamEncoder: string   // SimpleOutput/StreamEncoder ini value
  videoBitrateKbps: number
  audioBitrateKbps: number // 160
  label: string            // for stats/UI, e.g. 'NVENC', 'VAAPI', 'x264'
}
export function choosePreset(kind: EncoderKind, outputHeight: number, fps: number): EncoderPreset
```

Simple-mode ini values: nvenc → `'nvenc'`, vaapi → `'ffmpeg_vaapi'`,
x264 → `'x264'`.

Bitrate table (YouTube-recommended upper range — GW2 is high-motion; fps
"high" means ≥ 50):

| output height | high fps | low fps |
|---|---|---|
| ≥ 1440 | 24000 | 13000 |
| ≥ 1080 | 9000 | 6000 |
| ≥ 720 | 6000 | 4000 |
| below | 2500 | 2500 |

Audio: 160 kbps always.

### detect-encoders.ts

```ts
export interface DetectDeps { platform: NodeJS.Platform; existsSync(p: string): boolean; readdirSync(p: string): string[] }
export function detectEncoder(d: DetectDeps): EncoderKind
```

Linux: NVENC if `/dev/nvidiactl` or `/dev/nvidia0` exists; else VAAPI if
`/dev/dri` contains an entry starting with `renderD`; else x264. Non-Linux:
x264 (until those platforms ship). `readdirSync` failures → treated as no
DRI. Detection is a *hint* — OBS's own availability check is the authority,
so false positives cost nothing worse than OBS's silent x264 fallback.

### apply-encoder-settings.ts

```ts
export interface ApplyEncoderDeps { call: (req: string, params?: object) => Promise<unknown> }
export async function applyEncoderSettings(deps: ApplyEncoderDeps, preset: EncoderPreset): Promise<boolean>
```

Four `SetProfileParameter` calls (each wrapped in `callReady`, mirroring
`ensureCleanProfile`'s startup-race handling):
`Output/Mode = 'Simple'`, `SimpleOutput/StreamEncoder = preset.streamEncoder`,
`SimpleOutput/VBitrate = String(preset.videoBitrateKbps)`,
`SimpleOutput/ABitrate = String(preset.audioBitrateKbps)`.
Returns false (never throws) on failure — go-live proceeds on whatever the
profile holds.

### StreamController changes

- `StreamDeps.encoderLabel?: () => string` — `mapStats` uses it (default
  `'x264'`), replacing both hardcoded literals.
- `StreamDeps.onStartFailure?: () => Promise<boolean>` — called in
  `failStart` only when the stream never became live and only once per
  `goLive` call. If it resolves true, the controller re-runs the start
  sequence (`SetStreamServiceSettings` + `StartStream` + fresh poll loop)
  instead of reporting ERROR. A second failure reports ERROR normally.
  Errors thrown by the hook are treated as false.
  **The retry path must not run the teardown hooks:** `hooks.onStop`
  completes the YouTube broadcast (`live.complete`), which would kill the
  session the retry is trying to save. On retry: clear the poll timer, issue
  a best-effort `StopStream`, call `onStartFailure`, and if true restart —
  `onStop` fires only on the terminal failure or a real stop.

### Wiring (index.ts)

- Boot: `const kind = settings.load().preferSoftware ? 'x264' : detectEncoder({ platform: process.platform, ...fs })`,
  kept with a `currentPreset` variable.
- After every `applyResolution()` (boot, provision, repair, switchSource):
  `currentPreset = choosePreset(kind, capture_.outputHeight, capture_.fps)`
  then `await applyEncoderSettings({ call }, currentPreset)`.
- `StreamController` deps: `encoderLabel: () => currentPreset?.label ?? 'x264'`,
  `onStartFailure: async () => { if (kind === 'x264') return false;
  kind = 'x264'; settings.patch({ preferSoftware: true });
  currentPreset = choosePreset('x264', …same dims…);
  return applyEncoderSettings({ call }, currentPreset) }` — so a hardware
  start failure permanently switches this install to software (self-heal:
  users can be un-stuck later by deleting `stream.json`; no UI for it, YAGNI).

### StreamSettings

`preferSoftware: boolean`, default `false`, boolean-validated on load like
`desktopEnabled`.

## Data flow

Boot → detect hardware → resolution applied → preset chosen from (encoder,
outputHeight, fps) → four profile parameters written → `StartStream` uses
them. Failed hardware start → one automatic in-flight retry on x264 →
`preferSoftware` persisted so future boots skip hardware. Stats chip shows
the preset's label while live.

## Error handling

Every OBS call best-effort (`callReady` + catch, return false). Detection
never throws (fs errors → x264/VAAPI degradation). Fallback hook errors →
treated as "don't retry" → normal ERROR path. Worst case everywhere: the
stream goes out on OBS defaults, exactly as today.

## Testing

- **`encoder-presets`** (pure): ini value per kind; full bitrate table
  (boundary cases 1440/1080/720, fps 50 boundary); audio always 160; labels.
- **`detect-encoders`**: nvidia node present → nvenc; only renderD128 →
  vaapi; neither → x264; readdir throws → x264; win32 → x264.
- **`apply-encoder-settings`**: emits the four SetProfileParameter calls
  with exact categories/names/values; returns false when a call keeps
  failing; never throws.
- **`StreamController`**: stats use `encoderLabel`; failed start with
  `onStartFailure` returning true retriggers `StartStream` (second
  `SetStreamServiceSettings` observed) and does not report ERROR; second
  failure reports ERROR; hook only called once; hook absent → today's
  behavior (regression); hook throwing → ERROR.
- **`StreamSettings`**: `preferSoftware` default/persist/validation.
- **Manual smoke:** on the NVIDIA dev box, confirm `basic.ini` gets
  `StreamEncoder=nvenc` + `VBitrate` matching the monitor, stream goes live
  hardware-encoded, and stats chip reads NVENC.

## Capture-package note

The three new files live in `packages/capture` (they are OBS-facing, like
`obs-profile.ts`) and are exported from its `index.ts`; capture has its own
vitest suite where their tests live.
