# Capture & Stream Resolution — Design

**Date:** 2026-06-24
**Status:** Approved (design), pending plan
**Scope:** Piece **A** of the "account for different screen resolutions" work. Piece **B** (app window / UI responsiveness) is a separate spec.

## Problem

The app currently reports a **hardcoded** capture meta — `{ sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, fps: 60 }` — in three places in `packages/app/src/main/index.ts` (provision, repair, boot), and it never tells OBS what canvas/output to use. OBS therefore streams at whatever its persisted video settings happen to be, independent of the user's actual monitor.

Consequences:
- A 1440p, 4K, or **ultrawide** user gets a stream that is cropped or mis-scaled relative to their screen.
- The UI's "Guild Wars 2 · 1920×1080 · 60fps" pill is fiction on any non-1080p display.

## Goal

Detect the **real** captured-monitor resolution from OBS, set OBS's base canvas to match it 1:1, derive an opinionated stream output resolution (capped at 1440p **by height**, preserving aspect ratio so ultrawide is never cropped), cap fps at 60, and feed the real numbers to the UI.

## Policy (decided)

- **Base canvas = monitor resolution, 1:1.** OBS captures the whole screen at native pixels.
- **Output (stream) resolution:** scale the base so that **height ≤ 1440**, preserving aspect ratio. Width is **not** capped — an ultrawide keeps its full width; YouTube letterboxes it. Monitors at or below 1440p height stream native.
  - 1920×1080 → 1920×1080 (native)
  - 2560×1440 → 2560×1440 (native)
  - 3440×1440 ultrawide → 3440×1440 (native — height already ≤1440, **no crop**)
  - 3840×2160 (4K) → 2560×1440
  - 5120×2160 (5K2K ultrawide) → 3412×1440
- **Even dimensions** are enforced on the output (H.264/encoders require even width & height); round each down to the nearest even number after scaling.
- **fps = 60**, fixed for v1 (capture fps detection is out of scope; the cap is what matters).

## Source of truth: OBS, not the OS

On Wayland the app cannot know **which** monitor the desktop portal shared, so it can't ask Electron/the OS for the resolution. But once the capture source is rendering, OBS knows the captured screen's native dimensions. So the app reads them back from OBS.

The dimensions come from the scene item's transform: `GetSceneItemId` (scene `Main`, source `AxiStream Capture`) → `GetSceneItemTransform` → `sceneItemTransform.sourceWidth` / `sourceHeight`. These reflect the capture source's native size = the monitor resolution.

## Architecture

### New capture-library unit: `capture-resolution.ts` (`@axistream/capture`)

Two exports:

**1. Pure helper — the policy math:**

```ts
export interface OutputResolution { width: number; height: number }

/** Scale (w,h) so height ≤ maxHeight, preserving aspect ratio; never upscale.
 *  Output dimensions are rounded down to the nearest even number.
 *  Returns null if w or h is not a positive finite number. */
export function fitOutputResolution(
  w: number, h: number, maxHeight: number,
): OutputResolution | null
```

- `h <= maxHeight` → `{ width: even(w), height: even(h) }` (native, only evening).
- `h > maxHeight` → scale factor `maxHeight / h`; `{ width: even(w * f), height: even(maxHeight) }`.
- `w` or `h` ≤ 0 / NaN / Infinity → `null`.
- `even(n) = Math.max(2, Math.floor(n / 2) * 2)`.

**2. Side-effecting unit — read dims, set OBS video settings:**

```ts
export interface CaptureResolution {
  baseWidth: number; baseHeight: number
  outputWidth: number; outputHeight: number
  fps: number
}

export interface ResolutionDeps {
  call: <T = unknown>(req: string, params?: object) => Promise<T>
  sceneName?: string   // default 'Main'
  sourceName?: string  // default 'AxiStream Capture'
  maxHeight?: number   // default 1440
  fps?: number         // default 60
}

/** Read the captured monitor's native size from OBS, compute the output
 *  resolution, and apply both to OBS via SetVideoSettings. Returns the
 *  applied CaptureResolution, or null if dims are unreadable (capture not
 *  yet rendering) or any call fails — caller leaves OBS untouched and keeps
 *  going. Never throws. */
export async function applyCaptureResolution(
  deps: ResolutionDeps,
): Promise<CaptureResolution | null>
```

Flow:
1. `const { sceneItemId } = await call('GetSceneItemId', { sceneName, sourceName })`
2. `const { sceneItemTransform } = await call('GetSceneItemTransform', { sceneName, sceneItemId })`
3. `baseWidth = Math.round(sceneItemTransform.sourceWidth)`, `baseHeight = Math.round(sceneItemTransform.sourceHeight)`
4. `const out = fitOutputResolution(baseWidth, baseHeight, maxHeight)` — if `null`, return `null` (no-op).
5. `await call('SetVideoSettings', { baseWidth, baseHeight, outputWidth: out.width, outputHeight: out.height, fpsNumerator: fps, fpsDenominator: 1 })`
6. Return `{ baseWidth, baseHeight, outputWidth: out.width, outputHeight: out.height, fps }`.
7. Any thrown error / non-positive dims → catch, return `null`.

Exported from `packages/capture/src/index.ts`.

### App wiring (`packages/app/src/main/index.ts`)

- A small helper local to `index.ts`:
  ```ts
  const applyResolution = async (): Promise<CaptureMeta> => {
    const res = await applyCaptureResolution({ call: (r, p) => sidecar.client().call(r as any, p as any) })
    return res
      ? { sourceLabel: 'Guild Wars 2', width: res.baseWidth, height: res.baseHeight, fps: res.fps }
      : { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, fps: 60 } // fallback if unreadable
  }
  ```
- Replace the three hardcoded `capture: { ... 1920, 1080, 60 }` literals (provision handler, repair handler, boot-when-provisioned branch) with `capture: await applyResolution()`.
- Ordering: call `applyResolution()` **before** `startVirtualCam()` so the virtual camera (and the renderer preview) reflect the corrected canvas.

### Timing safety

`applyCaptureResolution` runs only when reaching `READY` (provision/repair/boot) — never during `LIVE`. Changing OBS's canvas while streaming would interrupt the broadcast. Repair routes through `SETTING_UP` first, so it is safe there too.

## Data flow

```
OBS (capture rendering)
  └─ GetSceneItemId / GetSceneItemTransform → sourceWidth/Height (monitor res)
       └─ fitOutputResolution → output (≤1440p height, even, no crop)
            └─ SetVideoSettings(base=monitor, output=fitted, fps=60)
                 └─ CaptureResolution → CaptureMeta {width:base,height:base,fps}
                      └─ setState({ capture }) → IPC → renderer pill "GW2 · 3440×1440 · 60fps"
```

`CaptureMeta` shape is unchanged (`{ sourceLabel, width, height, fps }`); `width`/`height` now carry real base/monitor pixels.

## Error handling

- Unreadable dims (capture not yet rendering, `sourceWidth` 0/missing) → `applyCaptureResolution` returns `null`; app falls back to the 1920×1080×60 meta and leaves OBS's settings as-is. Stream is never blocked.
- The function never throws; all OBS calls are inside a try/catch.
- It is idempotent and safe to re-run (repair re-invokes it).

## Testing

**Unit (capture lib, `packages/capture/test/capture-resolution.test.ts`):**

`fitOutputResolution`:
- 1920×1080, max 1440 → 1920×1080 (native)
- 2560×1440, max 1440 → 2560×1440 (native)
- 3440×1440, max 1440 → 3440×1440 (ultrawide native, no crop)
- 3840×2160, max 1440 → 2560×1440 (4K downscale)
- 5120×2160, max 1440 → 3412×1440 (even rounding; 5120×1440/2160 = 3413.3 → floor-even 3412)
- odd-scaled width rounds down to even
- 0 / -1 / NaN / Infinity → null

`applyCaptureResolution` (mocked `call`):
- happy path: returns `{base, output, fps}`, asserts `SetVideoSettings` called once with `baseWidth/baseHeight=` source dims, `outputWidth/outputHeight=` fitted, `fpsNumerator=60, fpsDenominator=1`.
- `GetSceneItemTransform` returns `sourceWidth: 0` → returns `null`, `SetVideoSettings` NOT called.
- a `call` rejects → returns `null`, never throws.

**Integration (real OBS, local, not CI):** provision a capture, run `applyCaptureResolution`, then `GetVideoSettings` reflects base = the monitor and output = fitted.

**App wiring:** no new unit test; covered by the existing e2e shell smoke + manual run (the pill shows real numbers).

## Out of scope (this spec)

- App window / UI responsiveness to display size & DPI — **piece B**, separate spec.
- Per-monitor capture-fps detection (we fix fps at 60).
- A user-facing resolution/quality picker (the policy is opinionated for v1).
- The `StatChips` "1080p60" literal is cosmetic and may be updated in piece B or a follow-up; not required here.
