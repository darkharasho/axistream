# Stream Audio Check ("Test audio") — Design

**Date:** 2026-07-07
**Status:** Approved (design); pending implementation plan
**Scope:** A "Test audio" button that records ~6 seconds of the REAL OBS
output (same scene, mix, tracks, and encoders as the stream) and plays it
back in-app, so the user hears exactly what viewers will hear before going
live.

## Purpose

On 2026-07-06 a stream went out with no mic audio while every in-app
indicator (meters, checkboxes, device pickers) looked healthy — the
indicators show the *ingredients*, not the *output* (see the mic-silent
incident investigation). The only trustworthy pre-flight check is sampling
the actual encoded output. This feature records a short clip via OBS's
Simple-output recorder — which shares the stream's audio pipeline — and
plays it back.

## Non-goals

- Persistent local VOD recording (separate feature; this builds the record
  plumbing it will reuse).
- Live self-monitoring (OBS monitor-only), waveform visualisation, or
  audio-quality analysis (silence detection etc.). The user's ears judge.
- Testing while live (recording mid-stream is pointless for pre-flight; the
  button is disabled once GOING_LIVE/LIVE/RECONNECTING).
- Windows/macOS specifics beyond what the existing OBS pipeline already
  abstracts.

## Architecture

| Unit | Responsibility |
|------|----------------|
| `RecordController.ts` (new, app main) | drive one test recording over obs-websocket: set Simple-output record profile params, `StartRecord`, wait ~6 s, `StopRecord`, return the clip's `outputPath`. Injected client + injected sleep for tests. Best-effort: returns a structured result, never throws. |
| `index.ts` (extend) | `recordAudioTest` IPC handler: guard on phase, call the controller, read the clip file, delete it, return the bytes + mime to the renderer. Boot-time sweep of stale test clips. |
| `ipc.ts` / `preload` / `state.ts` (extend) | `recordAudioTest(): Promise<AudioTestResult>` channel; `AudioTestResult` shared type. |
| `AudioSettings.tsx` (extend) | the "Test audio" button + `recording → playback / error` UI states, local 6 s countdown, `<audio>` playback from a Blob URL. |

### RecordController.ts

```ts
export interface RecordDeps {
  client(): { call(req: string, data?: unknown): Promise<any> }
  sleep?: (ms: number) => Promise<void>       // injectable for tests
}
export interface TestRecordingResult { ok: boolean; outputPath?: string; error?: string }

export class RecordController {
  constructor(private readonly d: RecordDeps) {}
  async recordTestClip(durationMs: number, dir: string): Promise<TestRecordingResult>
}
```

`recordTestClip`:

1. Set Simple-output record profile params (each via `SetProfileParameter`,
   category `SimpleOutput`):
   - `FilePath` = `dir` (the OS temp dir the caller passes)
   - `RecFormat2` = `'fragmented_mp4'` (plays natively in Chromium; survives
     a crashed writer)
   - `RecQuality` = `'Stream'` (same encoders as the stream — the audio path
     under test is byte-identical to what viewers get, and no second encode
     is spun up)
2. `StartRecord`.
3. `await sleep(durationMs)` (default injected `setTimeout`; caller passes 6000).
4. `StopRecord` → response carries `outputPath`; return `{ ok: true, outputPath }`.
5. Any step failing → `{ ok: false, error }` + `console.warn`; a failed
   `StartRecord` skips `StopRecord`; a `StopRecord` failure after a
   successful start attempts one `StopRecord` retry then gives up (never
   throws; a dangling record is stopped by the next test run or OBS exit).

Note: the profile params persist in the OBS profile. That is acceptable —
the AxiStream profile is app-owned, nothing else records, and the future
VOD-recording feature will own these same params (this controller is its
foundation).

### IPC handler (index.ts)

```ts
recordAudioTest: async () => {
  if (stream.isLive() || state.phase === 'GOING_LIVE' || !state.capture) {
    return { ok: false, error: 'not available right now' }
  }
  const r = await recorder.recordTestClip(6000, app.getPath('temp'))
  if (!r.ok || !r.outputPath) return { ok: false, error: r.error ?? 'recording failed' }
  try {
    const bytes = await fs.promises.readFile(r.outputPath)
    await fs.promises.unlink(r.outputPath).catch(() => {})
    return { ok: true, clip: bytes, mime: 'video/mp4' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
},
```

- The clip travels over IPC as a `Buffer` (structured clone → `Uint8Array`
  in the renderer; no base64 inflation). ~6 s at stream bitrate is single-
  digit MB — fine for a one-shot invoke.
- The temp file is deleted right after reading. Boot additionally sweeps
  `app.getPath('temp')` for stale `*.mp4` files whose names match OBS's
  default `FilenameFormatting` older than a day — best-effort, silent.
  (OBS names the file; we never control the name, so match on directory +
  age, and only in our temp dir.)

### Shared type + channel (state.ts / ipc.ts / preload)

```ts
export interface AudioTestResult { ok: boolean; clip?: Uint8Array; mime?: string; error?: string }
// CH.recordAudioTest = 'axi:recordAudioTest'
// AxiApi.recordAudioTest(): Promise<AudioTestResult>
```

### UI (AudioSettings.tsx)

A `yt-discord`-style block at the bottom of the Audio section:

- **Idle:** `[▶ Test audio]` button + hint "Records 6 seconds of your actual
  stream output — speak, and check your game is audible.". Disabled unless
  `phase` is one of `READY`/`NEEDS_KEY`/`NEEDS_TITLE` (the component already
  receives `phase`; the main handler additionally guards on live state and
  capture presence).
- **Recording:** button disabled, label counts down "Recording — speak now… 6/5/4…"
  (local `setInterval`; the invoke resolves when the clip is ready).
- **Ready:** an `<audio controls>` element with the Blob URL
  (`URL.createObjectURL(new Blob([clip], { type: mime }))`) + a "Test again"
  button. Revoke the previous object URL on re-test/unmount.
- **Error:** the error string + "Try again".

State is local to the component (`idle | recording | ready | error`).

## Error handling

Best-effort at every layer: OBS call failures surface only in the test UI
(never thrown, never block anything else); the handler guards live phases;
file read/unlink failures produce a readable error. A user clicking Test
audio twice cannot overlap: the button is disabled while a test is in
flight.

## Testing

- **RecordController** (injected client + sleep):
  - happy path: sets the 3 profile params, StartRecord, sleeps the duration,
    StopRecord, returns outputPath from the response.
  - StartRecord failure → `{ ok: false }`, StopRecord never called.
  - StopRecord failure → one retry, then `{ ok: false }`, no throw.
  - profile-param failure → `{ ok: false }`, StartRecord never called.
- **AudioSettings UI**: button renders and is disabled while live/GOING_LIVE
  or without capture; click → recording state; resolved `{ ok, clip, mime }`
  → an `<audio>` element appears; `{ ok: false, error }` → error text +
  retry. Mock `recordAudioTest`.
- **IPC plumbing**: covered by tsc + the existing pattern (no index.ts harness);
  review-verified: live-phase guard, unlink after read, Buffer return.
- **Manual smoke**: with capture ready, press Test audio, speak → playback
  contains your voice + game audio; press while a stream is live → button
  disabled.
