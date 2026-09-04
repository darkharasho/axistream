# Encoder codec picker — design

**Date:** 2026-09-03
**Source:** Discord thread `1545260554036314163` — "AxiStream: AV1 and NVENC support"
(tags: AxiStream, Idea), requested by iruixos with a screenshot of OBS Studio's
encoder dropdown.

## The request

Let the user choose the encoder instead of AxiStream silently auto-picking one. The
attached screenshot is OBS's list, which is the target vocabulary:

Software (x264) · Hardware (NVENC, H.264) · Hardware (NVENC, AV1) · Hardware (AMD,
HEVC) · Hardware (NVENC, HEVC) · Hardware (AMD, H.264)

The headline asks are AV1 and the NVENC codec variants beyond H.264.

## Scope decisions

| Decision | Choice |
|---|---|
| Codecs the current ingest can't carry | Show them, disabled, with the reason |
| Relationship to the "Software encoding" checkbox | Picker absorbs it; checkbox is removed |
| GPU capability probing | None — reuse the existing cheap vendor hint |
| Recording codec | Out of scope |
| Advanced-output VAAPI | Out of scope — follow-up spec, needs AMD/Intel hardware |

## Background: two constraints that shape everything

### 1. AV1 and HEVC cannot go out over plain RTMP

YouTube ingests them only over enhanced-RTMP/RTMPS or HLS. AxiStream's go-live path
builds a plain RTMP ingest, whether from an OAuth broadcast or a pasted key. A user
selecting AV1 today would encode successfully and then fail at ingest.

So the picker renders every row from the screenshot, but AV1 and HEVC rows ship
**disabled**, labelled with the reason. The picker is honest about what the current
destination can carry — the same principle as the truthful stream-health chips. When
enhanced-RTMP ingest lands, those rows light up with no UI work.

### 2. AxiStream's VAAPI preset has never used VAAPI

`encoder-presets.ts` maps the `vaapi` kind to `SimpleOutput/StreamEncoder =
'ffmpeg_vaapi'`. In OBS 32.1.2 — the version this repo provisions — Simple output mode
has no VAAPI mapping. `frontend/utility/SimpleOutput.cpp:88`
`get_simple_output_encoder()` recognizes exactly twelve strings and ends:

```c
return "obs_x264";
```

`ffmpeg_vaapi` is not among them. The VAAPI encoders exist in OBS
(`plugins/obs-ffmpeg/obs-ffmpeg-vaapi.c` registers `ffmpeg_vaapi`,
`hevc_ffmpeg_vaapi`, `av1_ffmpeg_vaapi`) but are reachable only from **Advanced**
output mode; `grep -ri vaapi frontend/` hits nothing outside `MultitrackVideoOutput.cpp`,
an unrelated path.

Consequence: every AMD/Intel Linux user has been encoding in software x264 while
`StatChips` displayed "VAAPI". `applyEncoderSettings` pins `Output/Mode = Simple`, so
there is no escape hatch. `encoder-presets.test.ts:7` asserts the bug — it checks the
string AxiStream writes, never that OBS honors it.

Fixing this properly means Advanced output mode, and in Advanced mode the encoder's
bitrate is not a profile parameter at all: `AdvancedOutput.cpp:77` reads it from
`streamEncoder.json` in the profile directory, which `SetProfileParameter` cannot
reach. That is a separate piece of work needing AMD/Intel hardware to verify, and it
is deferred.

This spec therefore fixes the **claim**, not the **encoder**.

---

## Part 1 — `fix/vaapi-silent-x264`

Lands first, on its own branch. Independent of the picker; it is a live bug affecting
current users.

**Change.** The `vaapi` entry in the `ENCODERS` table maps to `streamEncoder: 'x264'`
with the label `x264`, carrying a comment that records why (Simple output mode has no
VAAPI mapping) and points at the follow-up spec.

`detectEncoder` is left alone deliberately: returning `vaapi` for a DRI render node is
still *true* — AMD/Intel hardware really is present — and it is the only vendor signal
in the codebase. Part 2 promotes exactly that probe into `detectVendor()` to decide
which rows the picker enables. Fixing the lie at the table keeps the diff to the one
place that was lying.

**Behavior.** Nothing changes for any user — AMD/Intel machines were already running
x264. Only the label becomes true: the chip reads "x264" instead of "VAAPI".

**Tests.** `encoder-presets.test.ts:7` currently asserts the bug and is rewritten. The
test worth adding is a guard: a constant listing the twelve strings
`get_simple_output_encoder()` recognizes, plus an assertion that every `streamEncoder`
value AxiStream can emit appears in it. That is the test that would have caught this,
and it protects every row added in Part 2.

## Part 2 — `feat/encoder-picker`

### Type model

`EncoderKind` (vendor-only) is replaced by `EncoderId`, a union of concrete
vendor+codec pairs, backed by a single table in `encoder-presets.ts`:

| id | label | OBS `StreamEncoder` | gate |
|---|---|---|---|
| `auto` | Auto (resolved) | resolved at apply time | — |
| `x264` | Software (x264) | `x264` | always available |
| `nvenc_h264` | Hardware (NVENC, H.264) | `nvenc` | NVIDIA present |
| `nvenc_hevc` | Hardware (NVENC, HEVC) | `nvenc_hevc` | NVIDIA + enhanced RTMP |
| `nvenc_av1` | Hardware (NVENC, AV1) | `nvenc_av1` | NVIDIA + enhanced RTMP |
| `amd_h264` | Hardware (AMD, H.264) | `amd` | AMF — Windows only |
| `amd_hevc` | Hardware (AMD, HEVC) | `amd_hevc` | AMF + enhanced RTMP |
| `vaapi_h264` | Hardware (VAAPI, H.264) | — | Advanced output mode |

Every `StreamEncoder` value above is one of the twelve OBS recognizes, enforced by the
Part 1 guard test. `vaapi_h264` has no value because it is not reachable from Simple
output; it exists as a permanently-disabled row so Linux AMD/Intel users can see why
their hardware isn't being used, rather than wondering.

`amd_av1` from the screenshot is omitted: it is Windows-only AMF *and* enhanced-RTMP
gated, so it could never be enabled in any configuration this release supports. It is
added when either gate lifts.

### Availability

`detectEncoder` splits into two functions with distinct jobs:

- `detectVendor()` → `'nvidia' | 'amd-intel' | 'none'` — what the UI *displays*.
- `detectEncoder()` → what actually gets *written*, keeping today's cheap-hint logic
  and its stated philosophy: a false positive costs nothing worse than OBS's own
  fallback.

Availability is a pure function `(entry, vendor, platform) → 'ok' | DisabledReason`,
so the entire matrix is unit-testable with no OBS running. Reasons:

| reason | shown as |
|---|---|
| `enhanced-rtmp` | "Needs enhanced RTMP — not supported by the current YouTube ingest" |
| `no-vendor-gpu` | "No NVIDIA GPU detected" / "No AMD GPU detected" |
| `amf-windows-only` | "AMD hardware encoding is Windows-only" |
| `vaapi-advanced-mode` | "Needs OBS advanced output mode — not yet supported" |

**On Windows the picker will show only `Software (x264)` enabled.** That is not a
regression: `detectEncoder` already returns `x264` for every non-Linux platform, so
Windows users are on software encoding today — the picker just stops hiding it. Windows
vendor detection (and with it NVENC on Windows) is a follow-up.

### Settings and migration

`preferSoftware: boolean` becomes `encoder: EncoderId` (default `'auto'`).
`preferSoftwareAuto` becomes `encoderAuto`, unchanged in meaning: true when the
failed-go-live retry chose this, not the user.

Migration on load in `StreamSettings.ts`: `preferSoftware === true` → `encoder: 'x264'`;
`preferSoftwareAuto` carries over to `encoderAuto`. Absent or malformed → `'auto'`.

**Stale selections.** A persisted `nvenc_av1` can outlive the GPU it was set on. This
follows the existing `phantomHeight` precedent in `QualitySettings.tsx`: the option
stays visible and disabled with its reason, rather than silently collapsing the
`<select>` to a different value. At apply time an unavailable id resolves to `auto`,
and the chip reports what actually ran.

### Wiring

`index.ts:535` `detectKind()` becomes a resolver from `settings.load().encoder`:
`'auto'` calls `detectEncoder()`, anything else maps through the table, with an
availability check that falls back to `auto`. `choosePreset` takes an `EncoderId`.
`qualityViewOf` / `qualityPatchOf` in `quality.ts` swap `preferSoftware` for `encoder`,
keeping the existing rule that a user edit clears the `encoderAuto` explanation.

`applyEncoderSettings` is unchanged — it still writes Simple output parameters, and
stays best-effort per the OBS convention.

### UI

The picker replaces the "Software encoding" checkbox in `QualitySettings.tsx`. Disabled
rows remain visible with their reason inline. The existing auto-fallback note survives,
re-worded for the picker:

> AxiStream switched to software encoding after a stream failed to start — pick your
> graphics card again to retry it.

The existing quality chips are unchanged; `state.encoder` already shows the resolved
encoder label.

### Error handling

Unchanged in shape. `onStartFailure` sets `encoder: 'x264', encoderAuto: true` where it
previously set `preferSoftware`, and keeps the `pendingSoftwareFlip` rule: the choice
persists only if the x264 retry actually reaches LIVE, so a network outage does not
permanently flip the install to software.

### Testing

- **capture:** entry table shape; availability matrix across vendor × platform; the
  valid-OBS-string guard from Part 1 extended to every new row.
- **app:** settings migration from `preferSoftware`; `qualityPatchOf` / `qualityViewOf`
  mapping; `detectKind` resolution including the unavailable-id fallback.
- **renderer:** picker renders disabled rows with reasons; stale-selection case;
  auto-fallback note.

Typecheck gate: `cd packages/app && npx tsc --noEmit -p tsconfig.json`.

## Out of scope / follow-ups

1. **Enhanced-RTMP ingest** — the work that actually delivers AV1 and HEVC. Lights up
   four already-built rows.
2. **Advanced-output VAAPI** — real hardware encoding for Linux AMD/Intel. Requires
   writing `streamEncoder.json` via `obs-profile.ts` and AMD/Intel hardware to verify.
3. **Recording codec** — `RecordController` rides `RecQuality Stream`; a
   recording-specific encoder is its own feature. Local recording has no RTMP
   constraint, so HEVC/AV1 would work there today.

## Discord follow-up

The thread also reported "there's no forum tag for AxiStream" — already resolved; the
tag exists and is applied to the thread. When this ships, post back and close the
thread with the release version.
