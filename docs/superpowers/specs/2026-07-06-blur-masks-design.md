# Blur-Style Privacy Masks — Design

**Date:** 2026-07-06
**Status:** Approved (design); pending implementation plan
**Scope:** A global mask style — solid box (existing) or Gaussian blur —
where blur renders as region-masked `obs_composite_blur` filters on the
capture source. Includes generalizing the plugin-install machinery
(spec A) to a second flatpak extension.

## Ground truth (live probe + FiniteSingularity/obs-composite-blur source)

- Flathub extension: `com.obsproject.Studio.Plugin.CompositeBlur`;
  loaded filter kind: **`obs_composite_blur`** (visible in
  `GetSourceFilterKindList`).
- Filter settings (enums from `obs-composite-blur-filter.h`):
  `blur_algorithm` int — 1 = Gaussian (4 = Pixelate, future option);
  `blur_type` int — 1 = Area; `radius` double (default 10);
  `effect_mask` int — 2 = Rectangle; rectangle region keys
  `effect_mask_rect_center_x`, `effect_mask_rect_center_y`,
  `effect_mask_rect_width`, `effect_mask_rect_height` — **percentages
  (0–100) of the filtered source's dimensions** (defaults 50/50/50/50).
- Filters stack on a source: one filter per mask works.
- obs-websocket filter API: `GetSourceFilterList(sourceName)`,
  `CreateSourceFilter`, `SetSourceFilterSettings(overlay)`,
  `RemoveSourceFilter`. (No property-items enumeration for filters —
  enums above are source-quoted, which is why they're recorded here.)

## Decisions

- **Global style, not per-mask:** `maskStyle: 'box' | 'blur'`. Default
  `'box'` — opaque black is the stronger redaction and needs no plugin;
  the spec records that Gaussian blur is cosmetically nicer but
  theoretically weaker (inter-frame motion can leak information).
- Blur strength is fixed: `radius: 30`, `blur_algorithm: 1`,
  `blur_type: 1`. No sliders (opinionated; Pixelate/strength can come
  later).
- Filter naming: `AxiStream Blur <mask.id>` (`BLUR_PREFIX = 'AxiStream Blur '`)
  on source `AxiStream Capture`.
- Coordinate mapping from normalized `MaskRect` (capture fills the canvas,
  so source-relative == canvas-relative):
  `center_x = (m.x + m.w / 2) * 100`, `center_y = (m.y + m.h / 2) * 100`,
  `width = m.w * 100`, `height = m.h * 100`.

## Architecture

| Unit | Change |
|------|--------|
| `PluginInstaller` | parameterized by flatpak ref: `new PluginInstaller({ exec, ref })`; `PLUGIN_REF` becomes `GAME_AUDIO_PLUGIN_REF`, add `BLUR_PLUGIN_REF = 'com.obsproject.Studio.Plugin.CompositeBlur'`. New sibling `deriveBlurStatus(flatpak, filterKinds)` (ready = list contains the exact kind `obs_composite_blur`). The shared status types (`GameAudioPluginStatus`/`GameAudioPluginView`) are reused as-is for `blurPlugin` — structurally identical; renaming them app-wide is churn deferred until a third plugin appears |
| `StreamSettings` | `maskStyle: 'box' | 'blur'`, default `'box'`, enum-validated |
| `MaskController` | `applyMasks(masks, style)` reconciles BOTH representations: box style → color inputs (existing logic) + remove all `BLUR_PREFIX` filters; blur style → composite-blur filters (create/update settings incl. region percents) + remove all mask color inputs. Filter reconcile mirrors the input reconcile (list → remove stale → create-or-update) |
| state / IPC / preload | `AppState.blurPlugin: PluginView`; `AppState.maskStyle: 'box' | 'blur'`; channels `setMaskStyle(style)`, `installBlurPlugin()`; `relaunchApp` reused |
| `index.ts` | second installer instance; `setMaskStyle` handler (persist + `applyMasks` with new style + setState); blur-plugin boot probe alongside the audio one — one `GetSourceFilterKindList` call, logged `console.info('[blur] filter kinds', kinds)`; `installBlurPlugin` handler mirrors the audio one |
| `MaskEditor` | toolbar gains a style toggle: `Solid` / `Blur` segmented buttons. Blur button when `blurPlugin.status !== 'ready'`: shows the inline install prompt (Install → status text → Restart AxiStream), reusing the existing relaunch flow. Editor rectangles keep their current look in both styles (editor chrome ≠ stream look) |
| `StreamScreen` | passes `maskStyle` + `blurPlugin` + setter through to the editor |

### applyMasks(masks, style) reconcile detail

Blur branch, per mask:

```
settings = {
  blur_algorithm: 1, blur_type: 1, radius: 30,
  effect_mask: 2,
  effect_mask_rect_center_x: (m.x + m.w / 2) * 100,
  effect_mask_rect_center_y: (m.y + m.h / 2) * 100,
  effect_mask_rect_width: m.w * 100,
  effect_mask_rect_height: m.h * 100,
}
```

`GetSourceFilterList('AxiStream Capture')` → remove `AxiStream Blur *`
filters not in the mask list → for each mask: `CreateSourceFilter` if
missing else `SetSourceFilterSettings` (overlay). Box branch = existing
input reconcile + a filter sweep removing all `BLUR_PREFIX` filters.
Both branches best-effort; canvas-unreadable early-return only matters
for the box branch (blur uses percentages — no pixel math), but keeping
one guard is fine.

Re-apply points unchanged (boot + provision/repair/switchSource + edits) —
`applyMasks` reads the style from its new parameter; callers pass
`settings.load().maskStyle`. Note: after a capture rebuild the capture
INPUT survives (inputs are collection-global), so its filters survive
too — the reconcile still runs to heal drift.

## Non-goals

Per-mask styles; blur strength/algorithm UI (Pixelate later); blurred
editor chrome; uninstall UX.

## Error handling

House rules: every OBS call best-effort; a mask/filter failure never
blocks boot or go-live. Blur selected but plugin missing at apply time
(e.g. extension manually removed): filter calls fail silently, masks
simply don't render — the editor's style toggle shows the install prompt
again on next open (status derivation flips), and the user can switch
back to Solid. `setMaskStyle` is persisted before apply, mirroring the
sibling handlers.

## Testing

- **MaskController:** blur style creates filters with the exact settings
  object (percent math asserted: mask `{x:.25,y:.5,w:.1,h:.2}` →
  center 30/60, size 10/20); update path uses SetSourceFilterSettings
  overlay; stale blur filters removed; style switch box→blur removes
  color inputs and creates filters (and vice versa); non-AxiStream
  filters untouched; throwing client swallowed. Existing box tests keep
  passing with the new parameter.
- **PluginInstaller:** ref parameterization (both refs produce correct
  argv); `deriveBlurStatus` matrix (missing/installed/ready via filter
  kinds; `obs_composite_blur` exact match, no regex needed).
- **StreamSettings:** `maskStyle` default/persist/enum fallback.
- **MaskEditor (render):** toggle renders both options; selecting Blur
  when ready calls `setMaskStyle('blur')`; when not ready shows the
  install prompt and does NOT call the setter; Solid always available.
- **IPC contract:** new channels.
- **Manual smoke:** with a mask over chat, switch to Blur → preview shows
  a blurred region (not black); box↔blur round-trip leaves no orphan
  inputs/filters (check via OBS websocket or the editor still aligning).
