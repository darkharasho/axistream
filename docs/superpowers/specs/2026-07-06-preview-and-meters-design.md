# Full-Frame Preview + Audio Pulse Meters — Design

**Date:** 2026-07-06
**Status:** Design presented in-session; implementation started on a branch pending final user nod before merge
**Scope:** Two user-requested items: (A) the preview always shows the full
capture (contain) with blurred letterbox bars and a fit-window button;
(B) per-source audio pulse indicators driven by OBS volume meters.

## Part A — Full-frame preview

**Problem:** `.preview-video` is `object-fit: cover` — an ultrawide capture
in a 16:9-capped window is cropped, so masks can't be drawn (or seen) over
the cropped regions.

- **Contain, always:** `.preview-video` switches to `object-fit: contain`.
- **Blurred bars:** a second `<video>` (`.preview-backdrop`) behind it
  plays the SAME `MediaStream` (one stream, two `srcObject` attachments —
  legal), `object-fit: cover; filter: blur(28px) brightness(.55)`. Bars
  become a blurred extension of the game. `PreviewVideo` owns both
  elements; play/fade state keyed off the front video as today. The
  backdrop now touches the window corners, so it carries the self
  border-radius (the hardware-overlay note in styles.css); the front video
  keeps its radius too (harmless).
- **Mask editor mapping:** new pure `containContentRect(videoW, videoH,
  elemW, elemH)` in `cover-transform.ts` — identical to `coverContentRect`
  with `Math.min` scale; same degenerate fallback. `MaskEditor` switches to
  it. `coverContentRect` is then unused — delete it and its tests (the
  contain variant gets equivalents).
- **Fit-window button:** floating icon button (`Scan` lucide icon,
  `.fit-btn`, absolute bottom-right of the hero above `.hero-bottom`,
  title `Fit window to game`), visible whenever `state.capture` exists and
  phase isn't `SETTING_UP`. Calls `axi.fitWindowToCapture()`.
- **Main handler + pure helper:** `CH.fitWindowToCapture`. In
  `window-size.ts`: `fitWidthForCapture(sidebarW: number, contentHeight:
  number, capW: number, capH: number, minW: number, maxW: number): number`
  = `clamp(round(sidebarW + contentHeight * capW / capH), minW, maxW)`;
  returns `minW` on degenerate capture dims. Handler: no-op without
  `state.capture`; reads `win.getContentSize()`, work area via
  `screen.getDisplayMatching(win.getBounds()).workArea`, calls
  `win.setContentSize(w, h)`. `SIDEBAR_W = 200` constant in index.ts with
  a comment noting it mirrors the CSS `.sidebar` width.

## Part B — Audio pulse meters

**Problem:** no feedback that a selected source is actually producing
audio (is Discord capture working?).

- **Transport:** OBS's `InputVolumeMeters` event batch (opt-in
  `EventSubscription.InputVolumeMeters`, ~20 Hz). A DEDICATED second
  websocket connection carries it so the high-volume events never touch
  the sidecar's control connection.
- **Capture pkg:** `ObsSidecar.wsInfo(): { url: string; password: string } | null`
  (null before start) — `url = ws://127.0.0.1:${port}`.
- **App main — `AudioLevelMeter.ts`:** deps
  `{ info(): { url: string; password: string } | null, onLevels(l: AudioLevels): void, makeClient?: () => OBSWebSocket }`.
  `start()`: connect with
  `{ eventSubscriptions: EventSubscription.InputVolumeMeters }`; on the
  `InputVolumeMeters` event map inputs by name —
  `AxiStream Desktop Audio` → `desktop`, `AxiStream Mic` → `mic`,
  `AxiStream Game Audio` → `game` — each level = max of all channels'
  first element (`inputLevelsMul[ch][0]`), clamped 0..1. Throttle pushes
  to ≥100 ms apart. Reconnect on close with 3 s backoff while started;
  `stop()` disconnects. All best-effort; never blocks boot.
  `AudioLevels = { desktop: number; mic: number; game: number }`.
- **Wiring:** started after the provisioned boot completes (and after
  rebuilds it just keeps its own connection — the sidecar port doesn't
  change within a session; on OBS restart the reconnect loop reattaches).
  Levels push on new event channel `CH.evtAudioLevels`;
  `AxiApi.onAudioLevels(cb): () => void` (transient — NOT in AppState,
  like stats/preview frames). `preview.stop()`-style `meter.stop()` on
  window close.
- **UI:** `AudioPulse({ level })` — inline SVG, three 3px bars whose
  heights scale with `level` (CSS transition for decay), container class
  `live` when `level > 0.02` (grey → cyan). Placement in the hear-list:
  right edge of the **All desktop audio** row, the **Microphone** row, and
  the **Only these apps** divider (one meter for the whole app group —
  OBS meters are per-input and all selected apps share one input; per-app
  meters would require one input per app, rejected as source sprawl).
  `AudioSettings` subscribes via `onAudioLevels` in an effect.

## Non-goals

Numeric dB meters; per-app levels within the group input; persisting
levels; fit-button height adjustments (width-only fit).

## Error handling

Meter connection failures retry quietly; no UI error state (pulses just
stay grey). Fit with degenerate capture dims no-ops. All house rules.

## Testing

- `containContentRect` unit tests (fit-width, fit-height, exact, degenerate).
- `fitWidthForCapture` unit tests (ultrawide widen, clamp to max/min,
  degenerate → min).
- `AudioLevelMeter` with injected fake client: subscribes with the right
  flag; maps the three inputs and ignores others; max-across-channels;
  throttling (two events < 100 ms apart → one push); reconnect after
  close; stop() stops.
- `AudioPulse` render: level 0 → no `live`; 0.5 → `live` + scaled bars.
- `AudioSettings`: rows render pulses; levels event updates them
  (via the subscribed callback).
- `PreviewVideo`: both videos receive the stream (jsdom-level assertion
  that two video elements render; stream attachment covered by the
  existing acquire logic).
- ipc-contract: `fitWindowToCapture` channel.
- Manual smoke: ultrawide capture in 16:9 window shows blurred bars top/
  bottom and full frame; fit button removes bars; Discord noise pulses
  the apps meter.
