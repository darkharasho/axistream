# Recording (VOD) + End-of-Stream Summary — Design

**Date:** 2026-08-24
**Status:** Approved, ready for implementation plan
**Parent:** [1.0 Release Master Plan](./2026-08-24-v1.0-release-design.md) — sub-project 3 of 7

## Problem

AxiStream can stream but cannot keep a copy. The OBS record plumbing already exists —
`RecordController` drives `StartRecord`/`StopRecord` through OBS's Simple-output recorder —
but its only consumer is the six-second audio test, and `recordAudioTest` hard-guards
itself off whenever a stream is live. A GW2 streamer who wants the VOD has to run OBS
alongside AxiStream, which forfeits the point of the app.

Separately, ending a stream is an anticlimax: `stopStream` sets a flag, clears
`liveUnconfirmed`, calls `stream.stop()`, and the UI snaps back to `READY`. The session
just fought through — good or bad — leaves no trace. Nothing tells the user how long they
streamed, whether frames were dropping, where the VOD went, or where the video lives on
YouTube.

The two are grouped deliberately. The summary's main payoff is the open-your-recording
affordance; designing them apart means designing the summary twice.

## Goal

Record locally — while streaming or not — and give ending a stream a close: duration,
average bitrate, dropped percentage, watch link, and open-VOD.

## Decisions

Six decisions were settled during brainstorming and constrain everything below.

**Recording is an independent control, fully manual.** Record and stream are separate state
machines. Go Live never starts a recording; End Stream never stops one. This delivers the
master plan's "record without streaming" and keeps each machine's behaviour predictable.
The accepted cost: you can stream for two hours and discover you never pressed Record. We
take that over the alternative failure, a recorder silently running for an hour after the
stream ended.

**VODs are `fragmented_mp4`; the audio test keeps plain `mp4`.** A regular mp4 writes its
`moov` index last, so a crash mid-recording destroys the whole file — a non-event for a
six-second clip, the worst possible failure for a three-hour session. Fragmented mp4 is
crash-safe *and* still an mp4 that YouTube, Discord, and players accept. The audio-test
path is left alone: its `hasTopLevelMoov` check is built around the plain container and
that path took real debugging to get right.

**Consequence:** `RecordController` may no longer hardcode `RecFormat2`. Format becomes a
parameter, and every entry point sets all three profile parameters explicitly rather than
inheriting whatever the other path last wrote into the shared OBS profile.

**The record directory defaults to `~/Videos/AxiStream/` and is changeable, but must stay
under `$HOME`.** OBS writes from inside its flatpak, whose `/tmp` is a private tmpfs; a
path OBS cannot reach makes the output die instantly after `StartRecord` returns success —
`StopRecord` 501, no file. `$HOME` is mapped identically inside the sandbox. Configuration
is warranted because a fragmented-mp4 VOD at stream bitrate runs roughly 2.5 GB/hour at
6 Mbps, so "put it on the other drive" is the normal case, not an exotic one.

**The summary is a phase, not a modal or a toast.** After End Stream the stream screen's
hero area becomes the summary instead of snapping back to `READY`. A modal blocks the app
at exactly the moment a user may want to start another stream. A toast is wrong by the rule
sub-project 1 established — a summary is a *condition* read at the user's pace with actions
attached, and toasts carry no action buttons by design.

**Summary statistics are accumulated live, never computed retroactively.** OBS's stats are
instantaneous: `LiveStats` reports the bitrate right now, and after `stream.stop()` there is
nothing left to read. Average bitrate requires a sampler running off the existing stats
tick, snapshotted at stop.

**The summary appears on failure paths too.** A stream that never confirmed live, or ended
in error, still gets a summary — duration and dropped stats are real regardless of what
YouTube did. Only the watch-link block is suppressed. Skipping the summary on failure would
hide precisely the session whose numbers matter most.

## Architecture

### 1. `RecordController` — generalized

`src/main/RecordController.ts` gains a long-form recording lifecycle beside the existing
`recordTestClip`. Same best-effort contract as the rest of the OBS layer: it warns, it
returns errors, it never throws out.

```ts
export type RecordFormat = 'mp4' | 'fragmented_mp4'

export interface RecordStartResult { ok: boolean; error?: string }
export interface RecordStopResult { ok: boolean; outputPath?: string; error?: string }

class RecordController {
  recordTestClip(durationMs: number, dir: string): Promise<TestRecordingResult>
  startRecording(dir: string, format: RecordFormat): Promise<RecordStartResult>
  stopRecording(): Promise<RecordStopResult>
  isRecording(): Promise<boolean>   // GetRecordStatus.outputActive
}
```

`startRecording` reuses the proven sequence from `recordTestClip` verbatim: set `FilePath`,
`RecFormat2`, and `RecQuality` (`'Stream'`, so the recording shares the stream encoders and
costs no extra encode), `StartRecord`, then **sleep 300ms and verify `outputActive`**. That
verification is not optional — `StartRecord` resolving only means the request was accepted,
and an unreachable `FilePath` kills the output immediately afterward. If the output is not
active, `startRecording` reports failure rather than leaving the app believing it is
recording.

`stopRecording` keeps the two-attempt `StopRecord` retry and returns OBS's `outputPath`.
It does **not** wait for `moov` stability — fragmented mp4 needs no index fixup, and the
long-recording path must not block the UI for ten seconds after a stop.

The shared-profile hazard: OBS has exactly **one** record output. The audio test and a VOD
recording cannot coexist, and both mutate the same `SimpleOutput` parameters. Guarding is
handled at the IPC layer (§4), not inside the controller.

### 2. Stream summary accumulator

New `src/main/stream-summary.ts` — a pure, dependency-free unit, trivially testable:

```ts
export interface StreamSummary {
  durationMs: number
  avgBitrateKbps: number
  peakDroppedPct: number
  droppedFrames: number
  encoder: string
  watchUrl: string | null
  recordingPath: string | null      // a recording that finished during this stream
  recordingStillActive: boolean     // a recording was running when the stream ended
  endedWithError: boolean
}

export function createSummaryAccumulator(): {
  sample(s: LiveStats): void
  snapshot(extra: {
    watchUrl: string | null
    recordingPath: string | null
    recordingStillActive: boolean
    endedWithError: boolean
  }): StreamSummary
  reset(): void
}
```

- `avgBitrateKbps` is the mean of sampled `bitrateKbps`, **excluding zero-valued samples**.
  OBS reports 0 during the first tick or two and during a reconnect; averaging those in
  understates the real bitrate and would make a healthy stream look bad.
- `droppedFrames` and dropped percentage come from the **last** sample, since OBS reports
  those cumulatively for the session. `peakDroppedPct` is retained as the max seen, because
  a spike that recovered is still worth reporting.
- `durationMs` is the last sample's `durationMs`, which OBS already tracks from stream
  start — no wall-clock arithmetic, no drift.
- Zero samples (a stream that died before the first tick) yields an all-zero summary rather
  than `NaN`. This is the failure path the spec explicitly promises to show.
- `endedWithError` is set by the caller, not inferred: true when the stream ended from the
  `ERROR` phase or while `liveUnconfirmed` was still set — that is, when the session never
  reached a confirmed live state. It drives the suppression of the watch-link block and
  nothing else.

The accumulator is fed from the existing stats tick in `index.ts` and reset on go-live.

### 3. Shared state

`src/shared/state.ts` gains:

```ts
export type StreamPhase = ... | 'LIVE' | 'RECONNECTING' | 'ENDED' | 'ERROR'

export interface RecordingState {
  active: boolean
  startedAt: number | null   // epoch ms, for a renderer-computed elapsed timer
  dir: string
  lastPath: string | null    // most recent finished recording, for "Open recording"
  error: string | null
}

export interface AppState {
  ...
  recording: RecordingState
  summary: StreamSummary | null
}
```

`StreamSettingsView` gains `recordDir: string`; `StreamSettingsData` and
`DEFAULT_SETTINGS` gain the same, defaulting to `''` — resolved to
`join(app.getPath('home'), 'Videos', 'AxiStream')` at load time, so the default follows the
user's actual home rather than being frozen at first run.

Elapsed recording time is derived in the renderer from `startedAt`, not pushed. Pushing a
per-second counter through IPC would be a second stats channel for one number.

### 4. Main process — IPC and guards

New channels on `CH` and `AxiApi`:

| Channel | Signature | Notes |
|---|---|---|
| `startRecording` | `() => Promise<RecordStartResult>` | Creates the dir, starts, updates `AppState.recording` |
| `stopRecording` | `() => Promise<RecordStopResult>` | Sets `lastPath` on success |
| `chooseRecordDir` | `() => Promise<{ ok: boolean; dir?: string; error?: string }>` | Native dialog + validation |
| `openRecording` | `(path: string) => Promise<{ ok: boolean; error?: string }>` | `shell.openPath`, falling back to `showItemInFolder` |
| `dismissSummary` | `() => Promise<void>` | `ENDED` → `READY`, clears `summary` |

**Mutual exclusion.** Because OBS has one record output:

- `recordAudioTest` gains `state.recording.active` to its existing guard.
- `startRecording` refuses while an audio test is in flight, tracked by a main-process flag
  the audio-test handler already implicitly owns.

The audio test's existing `stream.isLive()` guard is **left as-is**. Lifting it is not
required by this sub-project and the guard is harmless.

**Directory validation** (`chooseRecordDir`, and re-checked at `startRecording`): the path
must resolve under `app.getPath('home')` and be writable. Failures return a specific
message — "must be inside your home folder (AxiStream's OBS can't write outside it)" —
rather than letting a `/mnt/games` selection fail silently at record time.

**Filenames** are OBS's own, from the `FilePath` we set: no template engine, no
title-derived names. A filename built from a stream title would need slash and unicode
sanitizing and buys nothing over a sortable timestamp.

**Quit safety.** An `app.on('before-quit')` handler stops an active recording so the file
is finalized. Best-effort and time-boxed — quitting must not hang on OBS.

**`stopStream` becomes the summary hook.** Its current body — `liveWatchStop = true;
setState({ liveUnconfirmed: false }); await stream.stop()` — additionally snapshots the
accumulator and sets `phase: 'ENDED'` with the summary attached. The `ENDED` phase is
cleared by `dismissSummary`, by a new `goLive`, or by a capture change.

Recording failures raise `error` toasts, correctly by the sub-project 1 rule: a record
output dying is a discrete event. The recording's *ongoing* state stays in `AppState`.

### 5. Renderer

**`RecordButton.tsx`** — lives in the stream screen's control area beside Go Live.
Idle shows "Record"; active shows a red dot, the elapsed time, and "Stop". After a
recording finishes, `lastPath` surfaces an "Open recording" affordance. Disabled with an
explanatory title when an audio test is running.

**`StreamSummary.tsx`** — rendered by the stream screen when `phase === 'ENDED'`:

- Duration, average bitrate, and dropped frames as plain figures.
- Dropped frames get a **verdict, not a bare percentage**, matching the truthful health
  chips already shipped: `0.02% dropped — clean` versus `3.1% dropped — viewers likely saw
  stuttering`. A bare number means nothing to a GW2 player who has never read an OBS log.
- Watch-link block, rendered **only when `watchUrl` is non-null** (it is null in
  stream-key mode and on an unconfirmed go-live): **Copy link** via the main-process
  clipboard — never `navigator.clipboard`, the shortcut PR #12 had to walk back — and
  **Open on YouTube**.
- Recording block, in one of three states. A recording that **finished** during the stream:
  **Open recording** plus the path as selectable text, so a failed open still leaves
  something to copy. A recording **still running** (the normal case, since End Stream does
  not stop recordings): "Still recording — 42:15" with a **Stop recording** button, which
  on success swaps the block to the finished state without leaving the summary. No
  recording at all: the block is absent entirely.
- **Dismiss**, returning to `READY`.

**`RecordingSettings.tsx`** — a new Settings section showing the current folder, a Change
button (native picker), and the `$HOME` constraint stated in the UI rather than discovered
at record time.

## Data flow

```
Record pressed  →  startRecording  →  RecordController.startRecording(dir, 'fragmented_mp4')
                →  set params, StartRecord, sleep 300ms, verify outputActive
                →  ok:    setState({ recording: { active: true, startedAt: now } })
                →  fail:  toast(error) + recording.error, recording stays inactive

stats tick (live)  →  accumulator.sample(stats)   [alongside the existing evtStats push]

End Stream  →  liveWatchStop, stream.stop()
            →  summary = accumulator.snapshot({ watchUrl, recordingPath, endedWithError })
            →  setState({ phase: 'ENDED', summary })
            →  user: Open recording / Copy link / Open on YouTube / Dismiss → READY
```

Two ordering guarantees matter here. The snapshot is taken **before** anything clears
`stats`. And `recordingPath` is read from `recording.lastPath` while `recordingStillActive`
is read from `recording.active` — so both a recording stopped mid-stream and one still
running at End Stream are represented, rather than the summary silently showing neither.

## Error handling

| Failure | Behaviour |
|---|---|
| `StartRecord` accepted but output dies | Caught by the 300ms `outputActive` check; error toast, `recording.active` stays false |
| Record dir unwritable / outside `$HOME` | Rejected at pick time with a specific message; re-validated at start |
| `StopRecord` fails | Two attempts, then an error toast; `lastPath` stays null |
| Disk fills mid-recording | OBS stops the output; surfaced on the next `isRecording` poll as an error toast |
| App quits while recording | `before-quit` stops the recording, time-boxed |
| Stream ends with zero stats samples | All-zero summary, still shown, `endedWithError: true` |
| `shell.openPath` fails (no player) | Falls back to `showItemInFolder`; path remains selectable |

Consistent with the project rule, every OBS call here is best-effort: nothing in this
sub-project may throw out into the go-live path.

## Testing

- **`record-controller.test.ts`** (extend) — `startRecording` sets all three profile
  parameters including the passed format; returns failure when `outputActive` is false
  after the verify sleep; `stopRecording` retries `StopRecord` once and returns
  `outputPath`; the audio-test path still sets `RecFormat2: 'mp4'` and is unaffected by a
  preceding VOD recording.
- **`stream-summary.test.ts`** (new) — average excludes zero samples; cumulative dropped
  figures come from the last sample while `peakDroppedPct` retains the max; zero samples
  yields zeros, not `NaN`; `reset` clears between sessions.
- **`record-dir.test.ts`** (new) — a path under `$HOME` validates; a sibling of `$HOME`,
  a `/mnt` path, and a `..` traversal escaping `$HOME` are all rejected with the specific
  message.
- **`stream-summary.test.tsx`** (new) — the watch block is absent when `watchUrl` is null
  and present otherwise; the recording block is absent when there is no recording, shows
  Open recording when `recordingPath` is set, and shows Stop recording when
  `recordingStillActive` is true; stopping from the summary swaps the block in place
  without dismissing the summary; the
  dropped-frames verdict switches at the threshold; Copy link calls `axi.copyToClipboard`;
  Dismiss returns to `READY`.
- **`record-button.test.tsx`** (new) — idle/active labels; elapsed time derives from
  `startedAt`; disabled while an audio test runs.
- **`ipc-contract.test.ts`** (extend) — the five new channels are present in both `CH` and
  `AxiApi`.
- **`StreamSettings` migration** — an existing settings file without `recordDir` loads with
  the default rather than `undefined`.

Gates before merge, per project convention: `npm -w @axistream/app run test`,
`npm -w @axistream/capture run test`, and
`cd packages/app && npx tsc --noEmit -p tsconfig.json`.

**Manual smoke** (cannot be automated — needs real OBS): record without streaming and play
the file back; record during a stream and confirm the summary's Open recording works; kill
the app mid-recording and confirm the fragmented mp4 still plays.

## Out of scope (YAGNI)

- Separate recording quality/bitrate settings. VODs use `RecQuality: 'Stream'`; editable
  quality is sub-project 5's job and will cover both paths at once.
- Replay buffer / instant replay.
- Pause and resume recording.
- Recording-file management: browsing, deleting, disk-usage display, retention policies.
- Auto-upload of the VOD to YouTube.
- Split-by-size or split-by-time recording.
- Per-minute graphs, peak bitrate, or encoder-lag detail in the summary — diagnostics
  export already answers "something went wrong, I need detail".
- Automatic coupling of Record to Go Live in any form, including an opt-in setting.
