# Editable Quality Settings — Design

**Sub-project 5 of the AxiStream 1.0 release**
(see `docs/superpowers/specs/2026-08-24-v1.0-release-design.md`)

## Goal

Let a user override output resolution, frame rate, video bitrate, and the
hardware/software encoder choice, layered over the existing auto-detect —
which stays the default and the recommended path.

The governing constraint is that AxiStream remains download-and-go. A user
who never opens this panel must see no behavior change whatsoever, and the
panel itself must reassure far more often than it invites tinkering: its
collapsed state tells someone what they are already getting and that it is
fine.

## What exists today

The whole quality decision surface is three functions:

- `detectEncoder` (`packages/capture/src/detect-encoders.ts`) — a cheap
  hardware hint from `/dev/nvidiactl`, `/dev/dri/renderD*`, or the platform.
  OBS's own availability check is the real authority.
- `choosePreset` (`packages/capture/src/encoder-presets.ts`) — derives video
  bitrate from output height and fps via a fixed YouTube-recommended table,
  keyed on `fps >= 50`. Audio is a flat 160 kbps.
- `applyCaptureResolution` (`packages/capture/src/capture-resolution.ts`) —
  reads the captured monitor's native size, scales the output down to fit a
  `maxHeight`, and writes `SetVideoSettings`.

`applyEncoderSettings` writes the preset as OBS Simple-output profile
parameters. `preferSoftware` already exists on `StreamSettings`, but only the
app writes it: after a go-live fails on a hardware encoder, `StreamController`
retries on x264 and persists `preferSoftware: true` so the next boot skips the
broken encoder.

Two facts shaped this design:

1. `applyCaptureResolution` already accepts `maxHeight` and `fps` deps that no
   caller has ever supplied. Resolution and FPS need no new capture-layer code
   — only for those deps to finally be passed.
2. `baseWidth`/`baseHeight` are always the monitor's native size; only
   `outputWidth`/`outputHeight` scale. Masks and the webcam are positioned in
   base coordinates, so a resolution or FPS change never moves them.

## Decisions

**Auto is the default for every field, and Auto is a value in the list.**
Resolution and FPS are plain pickers whose first entry is Auto. Bitrate is a
separate auto/manual pair, because bitrate is the derived value in the
existing code and should keep tracking whatever resolution and FPS end up
being. Force-software is a checkbox.

**Overrides take effect at the next go-live.** `applyEncoderSettings` writes
profile parameters that OBS only reads at `StartStream`, so this matches the
engine's actual behavior. Editing while live is permitted and labeled
"Applies to your next stream" — locking the panel mid-stream would fail the
exact user who most needs it, the one watching frames drop and wanting a
lower bitrate next time.

**The option lists are fixed and filtered by the monitor.** Resolution offers
Auto / 720p / 1080p / 1440p, hiding entries the current capture cannot
produce (`fitOutputResolution` never upscales, so an unfiltered 1440p on a
1080p display would be a lie). FPS offers Auto / 30 / 60. Deriving the list
from the monitor's refresh rate was rejected: OBS reports the portal
capture's rate, GW2 rarely holds 144, and YouTube's ingest tiers that
`videoBitrate()` encodes top out at 60 — so it would mostly generate options
that produce a worse stream.

**Force-software is one field with two writers.** The checkbox reads and
writes the existing `preferSoftware`. The auto-flip and the user checkbox
express the same intent, so a second user-owned field would create an
invisible second cause for x264 — the same shape as the "streaming but no
stream" bug this project has already been bitten by. A sibling
`preferSoftwareAuto` boolean records *who* set it, and affects help text only.

## Data model

Three nullable fields on `StreamSettingsData`, `null` meaning Auto, plus the
provenance marker:

```ts
qualityHeight: number | null        // 720 | 1080 | 1440
qualityFps: number | null           // 30 | 60
qualityBitrateKbps: number | null   // 1000–51000
preferSoftwareAuto: boolean         // true when the failure path set preferSoftware
```

Defaults are `null, null, null, false`, so a fresh install and every existing
install behave exactly as today and there is no migration to write.

Flat fields rather than a nested `quality` object, because `load()` validates
field-by-field against `DEFAULT_SETTINGS`; three flat guards match that
pattern where a nested object would need a `sanitizeQuality` helper. Each
guard admits only a value from the allowed set — a hand-edited `999` reverts
to Auto rather than producing a resolution nothing can encode.

Bitrate bounds: floor 1000 (below this the stream is unwatchable and it is
more likely a typo), ceiling 51000 (YouTube's documented ingest maximum).
Clamped with the existing `clamp()`, so a typed 60000 becomes 51000 rather
than silently snapping back to Auto.

## Capture package

One new type and one signature change:

```ts
export interface QualityOverrides {
  videoBitrateKbps?: number | null
}

export function choosePreset(
  kind: EncoderKind, outputHeight: number, fps: number, overrides?: QualityOverrides,
): EncoderPreset
```

The body gains one branch:
`videoBitrateKbps: overrides?.videoBitrateKbps ?? videoBitrate(outputHeight, fps)`.
Every existing call site keeps working with the argument omitted.
`applyEncoderSettings`, `detect-encoders.ts`, and `fitOutputResolution` are
unchanged.

The override is deliberately bitrate-only: resolution and FPS are not
overrides at this layer, just dep values finally being passed.

Because `videoBitrate()` keys off `fps >= 50`, choosing 30fps with bitrate on
Auto yields 6000 kbps instead of 9000 at 1080p. That is correct — half the
frames need less bitrate — and it is why bitrate stays slaved by default
rather than being a number the user must keep in sync. It also means the Auto
summary recomputes on an FPS change, not only a resolution change.

## Main-process wiring

A resolver beside the existing helpers in `packages/app/src/main/index.ts`:

```ts
const qualityOf = (s: StreamSettingsData) => ({
  maxHeight: s.qualityHeight ?? 1440,
  fps: s.qualityFps ?? 60,
  overrides: { videoBitrateKbps: s.qualityBitrateKbps },
})
```

`applyResolution()` passes `maxHeight` and `fps` into `applyCaptureResolution`;
`applyEncoderPreset` passes `overrides` into `choosePreset`. Both keep reading
back `GetVideoSettings`, so `state.capture` remains the authority on what OBS
actually holds rather than what was asked for.

A new `setQuality` IPC takes a partial patch in the renderer's vocabulary —
`{ height?, fps?, bitrateKbps?, preferSoftware? }`, each mapping to its
`quality*` settings field — persists it, then:

- **Not live** — re-runs `applyResolution()` + `applyEncoderPreset()`
  immediately and pushes the resulting `capture` into state, so the preview,
  the capture pill, and the stat chips are truthful at once. Safe because only
  the output scale moves.
- **Live** — persists only; the renderer shows the deferred notice.

**Go-live re-runs the same apply pair unconditionally** before starting the
stream, rather than tracking a pending-change flag. It is four websocket
calls, idempotent, and already best-effort, and it makes the deferred case
work with no second code path and no flag that can desync. It also closes an
existing gap: bitrate is currently applied only at boot, provision, repair,
and source switch, so any drift is now corrected at the moment it matters.

**Force-software.** `encoderKind` is computed once at startup, so toggling the
checkbox requires re-deriving it (x264 if `preferSoftware`, else
`detectEncoder`) before re-applying. The auto-flip path that writes
`preferSoftware: true` after a failed live retry is untouched; it simply gains
a visible representation. `setQuality` writes `preferSoftwareAuto: false`
whenever the user touches the checkbox; the failure path writes `true`.

## Renderer

A new `quality` slice on `AppState` — `{ height, fps, bitrateKbps,
preferSoftware, preferSoftwareAuto }` — mirroring the settings fields. The
resolved values the summary needs already exist in state:
`capture.outputHeight`, `capture.fps`, `videoBitrateKbps`, `encoder`.

`QualitySettings.tsx` **replaces the existing read-only Quality section** in
`SettingsScreen`, keeping its current position between Camera and Recording.
That section already prints the encoder, bitrate, and "chosen automatically"
line, so this feature makes an existing panel editable rather than adding a
new one. Collapsed by default; the header button carries the resolved truth:

> **Quality** — Auto · 1080p60 · 6000 kbps · NVENC

with "Auto" replaced by "Custom" when any of the four differs from its
default. The collapsed summary is doing the real work here: for most users it
answers the question and ends the interaction.

Expanded, four controls following the patterns `WebcamSettings` established:

- **Resolution** — `<select>`: `Auto (1080p)` / `720p` / `1080p` / `1440p`,
  entries above `capture.height` omitted. The Auto label carries its resolved
  value so the list explains itself.
- **Frame rate** — `<select>`: `Auto (60)` / `30` / `60`.
- **Bitrate** — a `label.check` checkbox "Set the bitrate manually" revealing
  a number input, the same disclosure idiom as "Choose the camera format
  manually". Unchecking writes `null`.
- **Software encoding** — a `label.check` checkbox. Help text is conditional:
  normally "Use the CPU instead of your graphics card. Slower, but works
  everywhere."; when `preferSoftwareAuto` is set, "AxiStream switched to
  software encoding after a stream failed to start — uncheck to try your
  graphics card again."

While LIVE or RECONNECTING the controls stay enabled and a line under the
header reads "Applies to your next stream."

The Auto labels resolve from the capture's *base* height, not its current
output height — otherwise, with a custom 720p active, the Auto option would
mislabel itself as "Auto (720p)".

## Error handling

Unchanged from the project's standing discipline: every OBS call here is
best-effort. `applyCaptureResolution` returns `null` and leaves OBS untouched
when the capture is not yet rendering; `applyEncoderSettings` returns `false`
on any failure. Go-live proceeds on whatever the profile holds. Nothing in
this feature may throw out of the go-live path.

An out-of-range or corrupt persisted value degrades to Auto at load, so the
worst case for a damaged settings file is today's behavior.

## Testing

**Capture package** — `choosePreset` with an override returns it verbatim and
ignores the table; with `null` or omitted overrides falls back to the table
unchanged; the 30fps path drops a 1080p stream to the sub-50fps tier.
`applyCaptureResolution` gains one case asserting a supplied `maxHeight`/`fps`
reaches `SetVideoSettings` — nothing has ever exercised those deps.

**App main** — `StreamSettings` round-trips the four fields; each rejects a
garbage value back to its default; bitrate clamps at both ends; a settings
file written before this feature loads with all three `null` and
`preferSoftwareAuto: false`.

**Renderer** (`packages/app/test/quality-settings.test.tsx`) — the collapsed
header renders the resolved summary and distinguishes Auto from Custom; a
1080p capture omits the 1440p option; picking 720p calls `setQuality` with
`{ height: 720 }`; the manual-bitrate checkbox reveals the input and
unchecking writes `null`; the software checkbox's help text switches on
`preferSoftwareAuto`; LIVE renders the deferred notice.

**Manual smoke** (release checklist, not automated) — set 720p30 and confirm
the YouTube VOD reports 720p30; set a manual bitrate and confirm the stat chip
matches; tick software encoding and confirm the chip reads x264.

## Out of scope

Keyframe interval; encoder presets and tuning (p1–p7, CQP, rate-control mode);
audio bitrate, which stays fixed at 160; per-encoder advanced options; and any
separate recording-quality setting — recording uses `RecQuality Stream` and
follows the stream settings by design.
