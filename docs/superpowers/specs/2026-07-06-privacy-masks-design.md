# Privacy Masks — Design

**Date:** 2026-07-06
**Status:** Approved (design); pending implementation plan
**Scope:** User-positioned static privacy masks — solid rectangles composited
over the capture in OBS so chat/DMs/guild rosters never reach the stream.
This is the v1 differentiator named in the project brief.

## Problem

Everything AxiStream captures goes to YouTube verbatim. GW2's chat panel,
whispers, and guild UI sit at fixed screen positions; streamers want them
permanently blacked out. OBS can do this with manually-configured color
sources, but that requires opening OBS — which AxiStream deliberately hides.
AxiStream needs first-class masks: draw a rectangle on the preview, and that
region is covered on the outgoing stream (and in the preview, since the
preview is OBS's composited virtual-cam feed).

## Non-goals

Blur/pixelate effects; images or freeform shapes; per-mask colors; masks
anchored to game UI elements (no game-state reads in v1); scheduling or
hotkey toggling; more than `MAX_MASKS = 8` masks. Masks are static rectangles
in canvas space.

## Approaches considered

1. **OBS `color_source_v3` scene items above the capture (chosen).** One
   solid-color input per mask in scene `Main`, positioned with
   `SetSceneItemTransform`. Composited by OBS, so masks appear identically in
   the encoded stream, the virtual-cam preview, and any future recording.
   Pure obs-websocket calls — same machinery as everything else in the app.
2. **Crop filters on the capture source.** Only removes edges; can't cover an
   interior chat box. Rejected.
3. **Renderer-drawn masks re-injected via a browser source.** Requires
   serving HTML into OBS and keeping it in sync; heavy, fragile, and the
   preview/stream could diverge. Rejected.

## Data model

```ts
// shared/state.ts
export interface MaskRect { id: string; x: number; y: number; w: number; h: number }
```

Coordinates are **normalized (0–1) relative to the OBS base canvas**
(`baseWidth`/`baseHeight`, which equal the captured monitor). Normalized
coords survive a source switch to a different-resolution monitor with the
same *relative* placement — masks may need a nudge after a switch, which is
acceptable for v1 and cheaper than anchoring. `id` is a short random string
minted by the renderer (`crypto.randomUUID()` prefix).

Constants: `MASK_COLOR = 0xff15110f` (OBS ABGR integer for opaque RGB
`#0f1115`, the app's near-black), `MAX_MASKS = 8`,
`MASK_PREFIX = 'AxiStream Mask '`.

## Architecture

| Unit | Change |
|------|--------|
| `MaskController` (new, main) | reconciles OBS scene items with a `MaskRect[]`; best-effort like `AudioController` |
| `StreamSettings` | add `masks: MaskRect[]` (default `[]`) with load-validation (clamp, cap) |
| state / IPC / preload | `AppState.masks: MaskRect[]`; channel `setMasks`; `AxiApi.setMasks(masks)` |
| `index.ts` | construct controller; `setMasks` handler (persist + reconcile + setState); re-apply after boot/provision/repair/switchSource |
| `MaskEditor.tsx` (new, renderer) | edit-mode overlay on the preview: add, drag, resize, delete rectangles |
| `cover-transform.ts` (new, renderer) | pure mapping between canvas coords and the `object-fit: cover` preview element |
| `StreamScreen.tsx` | "Masks" toggle button in the status row; mounts `MaskEditor` when editing |

### MaskController (main)

```ts
interface MaskDeps { client(): { call(req: string, data?: unknown): Promise<any> } }

class MaskController {
  // Reconcile scene 'Main' to exactly match `masks`:
  //  1. GetVideoSettings → baseWidth/baseHeight (skip silently if unreadable)
  //  2. GetInputList → existing inputs named `${MASK_PREFIX}*`
  //  3. Remove inputs whose id is no longer in `masks` (RemoveInput)
  //  4. For each mask: CreateInput (color_source_v3, settings { color: MASK_COLOR,
  //     width: round(w×baseW), height: round(h×baseH) }) if missing, else
  //     SetInputSettings; then GetSceneItemId — if that fails the input exists
  //     but the (rebuilt) scene lost its item, so CreateSceneItem and re-get —
  //     then SetSceneItemTransform { positionX: x×baseW, positionY: y×baseH }
  async applyMasks(masks: MaskRect[]): Promise<void>
}
```

Input name = `MASK_PREFIX + mask.id`. Sizing lives in the *input settings*
(width/height), not scale, so transforms stay position-only. All calls are
best-effort (`console.warn`, never throw) — a mask failure must never block
go-live. Creating an input in a scene places its scene item on top of
earlier items, so masks always cover the capture; relative order among masks
is irrelevant (they're all the same color).

`applyMasks` is idempotent and doubles as the self-heal: called on boot
(after `applyResolution`), and after provision / repair / switchSource
(scene rebuild discards mask inputs — the same lifecycle gap
`ensureAudioInputs` plugs for audio).

### StreamSettings

`masks: MaskRect[]`, default `[]`. `load()` validation: keep only entries
with string `id` and finite numeric `x/y/w/h`; clamp `x/y` to 0–1 and `w/h`
to 0.01–1; drop entries beyond `MAX_MASKS`. Corrupt → `[]`.

### State / IPC / preload

- `AppState.masks: MaskRect[]`, `INITIAL_STATE.masks = []`.
- `CH.setMasks = 'axi:setMasks'`; `AxiApi.setMasks(masks: MaskRect[]): Promise<void>`.
  One full-array setter — the renderer owns edit interaction and sends the
  complete list on each commit (pointer-up / add / delete). No per-mask CRUD
  channels.
- `index.ts` handler: cap at `MAX_MASKS`, `settings.patch({ masks })`,
  `await maskCtl.applyMasks(masks)`, `setState({ masks })`.
- Boot: after the audio slice, `setState({ masks: s.masks })` and
  `await maskCtl.applyMasks(s.masks)`.

### Renderer — cover mapping

`.preview-video` uses `object-fit: cover`, so canvas pixels are uniformly
scaled by `max(elemW/videoW, elemH/videoH)` and center-cropped. Pure helper:

```ts
// cover-transform.ts
export interface CoverRect { left: number; top: number; width: number; height: number }
/** Rect (element px) that the video content occupies under object-fit: cover.
 *  May extend beyond the element (negative left/top) — that's the crop. */
export function coverContentRect(videoW: number, videoH: number, elemW: number, elemH: number): CoverRect
```

MaskEditor converts: element px = contentRect.left + normalized × contentRect.width
(and the inverse when committing drags). Canvas aspect equals video aspect
(the virtual cam emits the canvas), so `videoWidth/videoHeight` from the
`<video>` element are the canvas dims — the editor never needs
`state.capture`. Fallback when video dims are 0 (preview loading): treat the
element box as the content rect.

### Renderer — MaskEditor

- StreamScreen status row gains a "Masks" ghost button (lucide `Shield`
  icon) toggling local `editingMasks` state. Hidden during
  `SETTING_UP`/`AWAITING_APPROVAL`; available while live (edits apply to the
  outgoing stream in real time, which is the point).
- When editing: a full-hero overlay (`z-index` above the video, below the
  modals) renders one absolutely-positioned div per mask with a dashed
  border, a drag surface, one bottom-right resize handle, and an × delete
  button; plus a top bar with "Add mask" and "Done".
- "Add mask" appends a centered default (`x:0.375, y:0.4, w:0.25, h:0.2`);
  disabled at `MAX_MASKS`.
- Pointer interactions use pointer capture; move/resize update local state
  live (CSS only), and `axi.setMasks(all)` fires on pointer-up / add /
  delete. Resize clamps to keep the rect inside 0–1 and ≥ 0.01 size.
- Local state seeds from `state.masks` when edit mode opens; while editing,
  local state is authoritative (no echo fighting).
- Outside edit mode nothing extra renders — masks are visible because
  they're in the composited preview itself.

## Data flow

Drag ends → `setMasks(masks)` → persist to `stream.json` → `applyMasks`
reconciles OBS → composited feed (stream + preview) updates within a frame
poll. On boot or capture rebuild, persisted masks are re-applied the same
way settings/audio are.

## Error handling

Every OBS call in `MaskController` is best-effort. `GetVideoSettings`
unreadable → skip reconcile (retry happens at the next natural apply point).
`setMasks` IPC never rejects to the renderer. Settings validation guarantees
the controller only ever sees sane rects.

## Testing

- **`MaskController`** (unit, mock client): creates missing inputs with
  correct color/width/height; positions via `SetSceneItemTransform` with
  pixel coords; removes stale `AxiStream Mask *` inputs; leaves non-mask
  inputs alone; second apply with same list is a no-op-ish update (no
  duplicate CreateInput); throwing client swallowed.
- **`StreamSettings`**: masks default/persist/round-trip; invalid entries
  dropped; values clamped; cap enforced; corrupt file → `[]`.
- **`cover-transform`**: wider-than-element, taller-than-element, exact-fit,
  and degenerate (0-dim) cases.
- **`MaskEditor`** (render): renders a rect per mask; Add appends and calls
  `setMasks`; delete removes and calls `setMasks`; Add disabled at cap.
- **IPC/preload fixtures**: `setMasks` channel wired like siblings.
- **Manual smoke:** draw a mask over the GW2 chat box, confirm it shows in
  the preview and on a live YouTube stream, survives an app restart and a
  source switch.
