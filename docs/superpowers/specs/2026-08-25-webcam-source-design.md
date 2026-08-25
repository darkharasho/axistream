# Webcam Source — Design

**Sub-project 4 of 7** in the AxiStream 1.0 release
(`docs/superpowers/specs/2026-08-24-v1.0-release-design.md`).

## Goal

Composite a camera into the stream as a scene item: pick a device, put it in a
corner, size it, optionally mirror it. Nothing more.

A facecam is a secondary source. Every decision below resolves toward "the
stream survives without it" — the camera never blocks go-live, never blocks
boot, and never throws out of the main process.

## Scope

**In:** device selection, enable/disable, four corner presets, a size control,
horizontal mirror, an optional resolution/frame-rate override, and an
unavailable-device condition surfaced in the UI.

**Out of 1.0, deliberately:** free drag positioning, circle/rounded crops,
borders, chroma key, multiple cameras, and detection of a camera that opens
successfully but delivers black frames because another application holds it.

### Rejected alternatives

- **Free drag on the preview, reusing `MaskEditor`.** A facecam has four sane
  positions. `MaskEditor`'s drag interaction is entangled with mask-specific
  concerns — the `MAX_MASKS` cap, hit-testing across overlapping rects, the
  box/blur style split — so "reusing" it means refactoring a working, shipped
  editor for a feature that does not need the freedom. Corner presets are a
  pure function and test without a DOM.
- **Always-auto resolution with no override.** Tempting, because a cam
  composited at 20% of canvas width barely depends on source resolution. But a
  v4l2 device whose driver default is YUYV can land at 5fps, which is common
  enough on Linux that shipping without recourse makes the answer to a real bug
  report "cannot be fixed in the app."
- **Blocking go-live when the configured camera is missing.** Contradicts the
  project's governing rule that OBS-side problems never block going live.

## Architecture

### `WebcamController` (`packages/app/src/main/WebcamController.ts`)

Modeled directly on `MaskController`: a single idempotent, best-effort
`apply(cfg)` that reconciles OBS to match the config. Called on boot, after
every capture rebuild, and on every edit. Never throws; failures `console.warn`
and leave the stream running.

One OBS input, `AxiStream Webcam`. Input kind and device-property name come
from a `kindsFor(platform)` map, following the established shape in
`packages/capture/src/audio-inputs.ts`:

| platform | input kind    | device property   |
|----------|---------------|-------------------|
| linux    | `v4l2_input`  | `device_id`       |
| win32    | `dshow_input` | `video_device_id` |

The win32 branch is written but **untested** — there is no Windows camera in
CI. Omitting it would ship a dead feature in the Windows build; the map costs
one line either way. It is a port-note, not a 1.0 guarantee.

When `enabled` is false or `deviceId` is null, `apply` removes the input
entirely rather than hiding it, so a disabled camera holds no device handle.

### The scene-rebuild landmine

A capture rebuild (`RemoveScene` + `CreateScene`) destroys scene **items**
while inputs survive in the collection, and an input with no item in the
program scene is inactive. This silenced mic and desktop audio on stream before
`cf03496`.

`apply` therefore resolves its scene item as:

```
try    { GetSceneItemId }
catch  { CreateSceneItem }
```

and is invoked from the same three sites in `main/index.ts` that already
re-apply masks after a rebuild: `provision`, `repairCapture`, and
`switchSource`.

The item is then pinned to the top of the scene with `SetSceneItemIndex`.
Without it, z-order depends on whether masks happened to reconcile after the
camera was created — making "my camera is behind a black rectangle" an
intermittent bug rather than an impossible one.

### `webcam-layout.ts` — placement

Pure module, no OBS and no DOM:

```
placeWebcam({ corner, sizePct, mirrored, baseW, baseH, srcW, srcH })
  -> { positionX, positionY, scaleX, scaleY }
```

- Target width is `sizePct * baseW`, clamped to `0.15 <= sizePct <= 0.35`.
- Aspect ratio is preserved from `srcW`/`srcH`; height follows.
- Margin from each edge is `0.02 * baseW`.
- `corner` is one of `'tl' | 'tr' | 'bl' | 'br'`.
- Mirroring sets `scaleX` negative. **OBS scales a scene item about its
  origin**, so a negative `scaleX` extends the item leftward from
  `positionX`; `positionX` must shift right by the target width to compensate.
  This is the single most likely defect in the feature and is covered by a
  dedicated test rather than left to a live stream to reveal.

If `srcW`/`srcH` are unknown or zero, `apply` skips the transform and leaves
the item at OBS's defaults rather than dividing by zero.

## State and persistence

```ts
export interface WebcamConfig {
  enabled: boolean
  deviceId: string | null
  deviceLabel: string | null
  corner: 'tl' | 'tr' | 'bl' | 'br'
  sizePct: number            // 0.15 - 0.35
  mirrored: boolean
  mode: WebcamMode | null    // null = auto
}

// All three OBS v4l2 properties, set together. Picking a resolution without
// its pixel format is what produces the 5fps YUYV case this override exists
// to escape, so none of the three is optional.
export interface WebcamMode {
  pixelformat: string  // OBS property value, e.g. MJPEG vs YUYV
  resolution: string   // OBS property value
  framerate: string    // OBS property value
}

export interface WebcamOption { value: string; label: string }

// The three property lists as OBS currently reports them.
export interface WebcamProps {
  pixelformats: WebcamOption[]
  resolutions: WebcamOption[]
  framerates: WebcamOption[]
}

export interface WebcamView extends WebcamConfig {
  available: boolean
}
```

`AppState.webcam` is a `WebcamView`. Every field except `available` persists
via `StreamSettings`. Defaults: disabled, no device, `'br'`, `0.22`, not
mirrored, auto mode.

`mode: null` sets `res_type: 0` and lets the device choose. A non-null value
sets `res_type: 1` plus all three of `resolution`, `framerate`, and
`pixelformat` together — they are one choice, not three.

The property lists can only be queried once the input exists with a device
selected, so `getWebcamProps()` runs against the live input, never while
building the device picker.

**These three properties are dependent, not independent.** OBS recomputes the
valid framerate list from the currently-set resolution, and the resolution list
from the pixel format. obs-websocket reports each list only as it stands right
now, which means a single call cannot return the set of valid combinations —
a cross product of the three lists would contain modes the device cannot
actually produce.

The UI therefore mirrors OBS's own properties dialog: three dependent
dropdowns, where setting one re-fetches the others. This is the only shape
obs-websocket supports without one round trip per candidate resolution.

## IPC

Three channels, not one per field:

- `setWebcam(p: Partial<WebcamConfig>): Promise<void>` — merges, persists,
  reconciles. Follows the existing `saveSettings(p: Partial<...>)` shape;
  per-field channels in the `setMicDevice` style would mean six new ones.
- `getWebcamDevices(): Promise<AudioDevice[]>` — reuses the existing
  `{ id, name }` shape.
- `getWebcamProps(): Promise<WebcamProps>` — the three property lists as OBS
  reports them for the current device and current settings. All three arrays
  are empty when no device is selected. Called again after each `setWebcam`
  that changes `mode`, because the lists shift.

## Error handling

| Case | Behavior |
|---|---|
| Configured camera absent from the device list | `available: false`; chip in the UI; one toast on the transition into unavailable. Device is not set on the input — no pointing at a dead path. |
| Camera present but held by another app | **Not detected.** OBS creates the input and reports success while producing black frames. Distinguishing this from a lens cap needs frame inspection, which `frame-check.ts` does for capture and which is out of scope here. |
| Any OBS call fails | `console.warn`, reconcile abandoned, stream unaffected. |
| Camera vanishes mid-stream | Surfaced by the next `apply`; the stream continues without it. |

`available` is a **condition**, so it lives in `AppState` and renders as a
chip. The toast channel carries only the discrete transition — the rule
established in sub-project 1.

## UI

A `WebcamSettings` section in `SettingsScreen`, placed between Audio and
Quality: enable toggle, device picker, four corner buttons, size slider, mirror
checkbox, and an Auto/Manual mode control that reveals three dependent
dropdowns — pixel format, resolution, frame rate — which populate only after a
device is selected and re-fetch after each change. A quick on/off toggle joins the existing ones on the stream screen.

Framing needs no dedicated preview: the existing preview pump shows OBS program
output, so the camera appears there as soon as it is composited.

## Testing

- `WebcamController` against a fake client: create, update, remove-on-disable,
  the post-rebuild `CreateSceneItem` re-add, index pinning, and the
  unavailable-device path.
- `placeWebcam` arithmetic for all four corners, size clamping, aspect
  preservation, the mirror origin offset, and zero-dimension input.
- `kindsFor` platform map.
- `WebcamSettings` component, including that the mode dropdowns stay empty
  until a device is selected, and that changing one triggers a props re-fetch.
- The existing `ipc-contract` test covers channel/preload parity.

Manual smoke (needs real hardware): camera appears in each corner; mirror
flips it and it stays inside the frame; unplugging mid-stream degrades to a
chip without dropping the stream; the camera survives a `repairCapture` and a
`switchSource`.

## Known debt, not fixed here

The three rebuild call sites in `main/index.ts` are near-identical long lines,
and this feature adds a fourth thing each must remember to re-apply. That is
the same shape as the defect that silenced audio before `cf03496`. It is not
refactored as part of this sub-project — but if a fifth member is ever added,
these sites should first be collapsed into a single `reapplyAfterRebuild()`.
