# Full-Frame Preview + Audio Pulse Meters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) preview always shows the full capture via `contain` with blurred letterbox bars + a fit-window-to-capture button; (B) per-source audio pulse indicators driven by OBS `InputVolumeMeters` over a dedicated websocket connection.

**Architecture:** Part A is renderer-heavy (backdrop video, contain math in the mask editor, fit button) plus one pure helper and one main handler. Part B adds `ObsSidecar.wsInfo()` (capture pkg), an `AudioLevelMeter` main module with an injected client, a push-only `evtAudioLevels` channel, and an `AudioPulse` SVG in the hear-list. Spec: `docs/superpowers/specs/2026-07-06-preview-and-meters-design.md`.

**Tech Stack:** obs-websocket-js 5 (`EventSubscription.InputVolumeMeters`), Electron `setContentSize`, React 18, Vitest 2.

## Global Constraints

- No new dependencies; 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on relative imports.
- Exact input names for meters: `AxiStream Desktop Audio` → `desktop`, `AxiStream Mic` → `mic`, `AxiStream Game Audio` → `game`; level = max over channels of `inputLevelsMul[ch][0]`, clamp 0..1; throttle pushes to ≥100 ms; reconnect backoff 3000 ms; dedicated connection with `eventSubscriptions: EventSubscription.InputVolumeMeters` ONLY.
- `containContentRect` mirrors `coverContentRect` with `Math.min`; `coverContentRect` deleted once unused.
- `fitWidthForCapture(sidebarW, contentHeight, capW, capH, minW, maxW)` — clamp(round(sidebarW + contentHeight * capW / capH), minW, maxW); degenerate capW/capH → minW. `SIDEBAR_W = 200` (mirrors CSS `.sidebar` width — comment it).
- Pulse: `live` class when `level > 0.02`. Fit button: lucide `Scan`, class `fit-btn`, title `Fit window to game`, hidden during `SETTING_UP` or without `state.capture`.
- Meters are transient: event channel `axi:evt:audioLevels` + `onAudioLevels` subscription, NOT AppState.
- Gates per task: `npm -w @axistream/app run test` (+ capture suite when the capture pkg changes); final: `cd packages/app && npx tsc --noEmit -p tsconfig.json` zero.

---

### Task 1: contain math + fit-width helper (pure)

**Files:**
- Modify: `packages/app/src/renderer/cover-transform.ts`, `packages/app/src/main/window-size.ts`
- Test: `packages/app/test/cover-transform.test.ts`, `packages/app/test/window-size.test.ts`

**Interfaces:**
- Produces: `containContentRect(videoW: number, videoH: number, elemW: number, elemH: number): CoverRect` (exported from `cover-transform.ts`; `coverContentRect` NOT deleted yet — Task 3 deletes it after the editor switches); `fitWidthForCapture(sidebarW: number, contentHeight: number, capW: number, capH: number, minW: number, maxW: number): number` (exported from `window-size.ts`).

- [ ] **Step 1: Failing tests.** In `cover-transform.test.ts` append:

```ts
describe('containContentRect', () => {
  it('exact aspect fills the element', () => {
    expect(containContentRect(1920, 1080, 960, 540)).toEqual({ left: 0, top: 0, width: 960, height: 540 })
  })
  it('wider video letterboxes top/bottom (positive top)', () => {
    // 21:9 in 16:9: scale by width; height shrinks
    expect(containContentRect(2100, 900, 800, 450)).toEqual({ left: 0, top: 45, width: 800, height: 360 })
  })
  it('taller video pillarboxes left/right (positive left)', () => {
    expect(containContentRect(900, 900, 800, 450)).toEqual({ left: 175, top: 0, width: 450, height: 450 })
  })
  it('degenerate dims fall back to the element box', () => {
    expect(containContentRect(0, 0, 800, 450)).toEqual({ left: 0, top: 0, width: 800, height: 450 })
  })
})
```

In `window-size.test.ts` append:

```ts
describe('fitWidthForCapture', () => {
  it('ultrawide capture widens the window to remove bars', () => {
    // content height 840, capture 3440x1440 → 200 + 840*3440/1440 = 200 + 2006.66 → 2207
    expect(fitWidthForCapture(200, 840, 3440, 1440, 820, 3400)).toBe(2207)
  })
  it('clamps to the work-area max', () => {
    expect(fitWidthForCapture(200, 840, 3440, 1440, 820, 1800)).toBe(1800)
  })
  it('clamps to the window minimum', () => {
    expect(fitWidthForCapture(200, 300, 400, 1440, 820, 3400)).toBe(820)
  })
  it('degenerate capture dims return the minimum', () => {
    expect(fitWidthForCapture(200, 840, 0, 0, 820, 3400)).toBe(820)
  })
})
```

- [ ] **Step 2:** Run both test files → new tests FAIL (functions missing). Import lines updated.
- [ ] **Step 3: Implement.** `cover-transform.ts`:

```ts
/** Element-pixel rect a video occupies under object-fit: contain — always
 *  inside the element (letterbox/pillarbox bars are the remainder). */
export function containContentRect(videoW: number, videoH: number, elemW: number, elemH: number): CoverRect {
  if (!(videoW > 0) || !(videoH > 0) || !(elemW > 0) || !(elemH > 0)) return { left: 0, top: 0, width: elemW, height: elemH }
  const scale = Math.min(elemW / videoW, elemH / videoH)
  const width = videoW * scale
  const height = videoH * scale
  return { left: (elemW - width) / 2, top: (elemH - height) / 2, width, height }
}
```

`window-size.ts`:

```ts
/** Content width that makes the preview area (window minus sidebar) match
 *  the capture aspect exactly at the current content height. */
export function fitWidthForCapture(sidebarW: number, contentHeight: number, capW: number, capH: number, minW: number, maxW: number): number {
  if (!(capW > 0) || !(capH > 0) || !(contentHeight > 0)) return minW
  return Math.min(maxW, Math.max(minW, Math.round(sidebarW + contentHeight * (capW / capH))))
}
```

- [ ] **Step 4:** Both test files pass; full suite green.
- [ ] **Step 5: Commit** — `git add` the four files; message `feat(ui): contain content-rect + fit-width helpers`.

---

### Task 2: capture pkg — wsInfo + AudioLevelMeter (main)

**Files:**
- Modify: `packages/capture/src/obs-sidecar.ts`
- Create: `packages/app/src/main/AudioLevelMeter.ts`
- Test: `packages/capture/test/obs-sidecar.test.ts` (append), `packages/app/test/audio-level-meter.test.ts` (new)

**Interfaces:**
- Produces: `ObsSidecar.wsInfo(): { url: string; password: string } | null` (null before start; `url = 'ws://127.0.0.1:' + port`); `export interface AudioLevels { desktop: number; mic: number; game: number }`; `class AudioLevelMeter { constructor(d: { info(): { url: string; password: string } | null; onLevels(l: AudioLevels): void; makeClient?: () => any; backoffMs?: number; throttleMs?: number }); start(): void; stop(): Promise<void> }`.

- [ ] **Step 1: Failing tests.**

Append to `packages/capture/test/obs-sidecar.test.ts` (match its existing fake-launcher/fake-client harness):

```ts
  it('wsInfo is null before start and carries url+password after', async () => {
    const sc = makeSidecar() // reuse the file's existing construction helper/pattern
    expect(sc.wsInfo()).toBeNull()
    await sc.start()
    const info = sc.wsInfo()!
    expect(info.url).toBe(`ws://127.0.0.1:${sc.port}`)
    expect(typeof info.password).toBe('string')
  })
```

Create `packages/app/test/audio-level-meter.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { AudioLevelMeter } from '../src/main/AudioLevelMeter.js'

function fakeClient() {
  const handlers: Record<string, (d: any) => void> = {}
  return {
    connectArgs: [] as any[],
    connect: vi.fn(async function (this: any, ...args: any[]) { (this as any).connectArgs.push(args) }),
    disconnect: vi.fn(async () => {}),
    on: vi.fn((ev: string, cb: (d: any) => void) => { handlers[ev] = cb }),
    emit: (ev: string, d: any) => handlers[ev]?.(d),
  }
}

const meters = (name: string, mul: number) => ({ inputName: name, inputLevelsMul: [[mul, mul, mul], [mul / 2, 0, 0]] })

describe('AudioLevelMeter', () => {
  it('connects with the volmeter subscription and maps the three inputs (max across channels)', async () => {
    const c = fakeClient()
    const pushes: any[] = []
    const m = new AudioLevelMeter({ info: () => ({ url: 'ws://x', password: 'p' }), onLevels: (l) => pushes.push(l), makeClient: () => c as any, throttleMs: 0 })
    m.start()
    await new Promise((r) => setTimeout(r, 5))
    expect(c.connect).toHaveBeenCalled()
    const [, , opts] = (c.connect.mock.calls[0] as any[])
    expect(opts.eventSubscriptions).toBeGreaterThan(0) // InputVolumeMeters flag
    c.emit('InputVolumeMeters', { inputs: [meters('AxiStream Desktop Audio', 0.5), meters('AxiStream Mic', 0.2), meters('AxiStream Game Audio', 0.9), meters('Something Else', 1)] })
    expect(pushes[0]).toEqual({ desktop: 0.5, mic: 0.2, game: 0.9 })
    await m.stop()
  })

  it('missing inputs report 0 and values clamp to 1', async () => {
    const c = fakeClient()
    const pushes: any[] = []
    const m = new AudioLevelMeter({ info: () => ({ url: 'ws://x', password: 'p' }), onLevels: (l) => pushes.push(l), makeClient: () => c as any, throttleMs: 0 })
    m.start(); await new Promise((r) => setTimeout(r, 5))
    c.emit('InputVolumeMeters', { inputs: [meters('AxiStream Mic', 4)] })
    expect(pushes[0]).toEqual({ desktop: 0, mic: 1, game: 0 })
    await m.stop()
  })

  it('throttles pushes closer than throttleMs', async () => {
    const c = fakeClient()
    const pushes: any[] = []
    const m = new AudioLevelMeter({ info: () => ({ url: 'ws://x', password: 'p' }), onLevels: (l) => pushes.push(l), makeClient: () => c as any, throttleMs: 10000 })
    m.start(); await new Promise((r) => setTimeout(r, 5))
    c.emit('InputVolumeMeters', { inputs: [meters('AxiStream Mic', 0.5)] })
    c.emit('InputVolumeMeters', { inputs: [meters('AxiStream Mic', 0.6)] })
    expect(pushes).toHaveLength(1)
    await m.stop()
  })

  it('null info → start is a quiet no-op retry loop; stop ends it', async () => {
    const c = fakeClient()
    const m = new AudioLevelMeter({ info: () => null, onLevels: () => {}, makeClient: () => c as any, backoffMs: 5 })
    m.start(); await new Promise((r) => setTimeout(r, 20))
    expect(c.connect).not.toHaveBeenCalled()
    await m.stop()
  })
})
```

- [ ] **Step 2:** Run both → FAIL.
- [ ] **Step 3: Implement.**

`obs-sidecar.ts` — add:

```ts
  /** Connection info for auxiliary websocket connections (e.g. the audio
   *  level meter). Null until start(). */
  wsInfo(): { url: string; password: string } | null {
    if (!this.obs || !this._port) return null
    return { url: `ws://127.0.0.1:${this._port}`, password: this.password }
  }
```

`AudioLevelMeter.ts`:

```ts
import { OBSWebSocket, EventSubscription } from 'obs-websocket-js'

export interface AudioLevels { desktop: number; mic: number; game: number }

const NAME_TO_KEY: Record<string, keyof AudioLevels> = {
  'AxiStream Desktop Audio': 'desktop',
  'AxiStream Mic': 'mic',
  'AxiStream Game Audio': 'game',
}

export interface MeterDeps {
  info(): { url: string; password: string } | null
  onLevels(l: AudioLevels): void
  makeClient?: () => OBSWebSocket
  backoffMs?: number
  throttleMs?: number
}

/** Streams OBS volume meters over a DEDICATED websocket connection (the
 *  InputVolumeMeters subscription is high-volume; keeping it off the
 *  sidecar's control connection isolates the noise). Best-effort: quiet
 *  retry loop while started, never throws out. */
export class AudioLevelMeter {
  private started = false
  private client: OBSWebSocket | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastPush = 0

  constructor(private readonly d: MeterDeps) {}

  start(): void {
    if (this.started) return
    this.started = true
    void this.loop()
  }

  private async loop(): Promise<void> {
    while (this.started) {
      const info = this.d.info()
      if (info) {
        try {
          const c = (this.d.makeClient ?? (() => new OBSWebSocket()))()
          this.client = c
          c.on('InputVolumeMeters' as never, ((data: { inputs?: { inputName: string; inputLevelsMul: number[][] }[] }) => this.handle(data)) as never)
          const closed = new Promise<void>((resolve) => { c.on('ConnectionClosed' as never, (() => resolve()) as never) })
          await c.connect(info.url, info.password, { eventSubscriptions: EventSubscription.InputVolumeMeters })
          await closed // stay attached until the connection drops
        } catch { /* fall through to backoff */ }
        this.client = null
      }
      if (!this.started) return
      await new Promise<void>((resolve) => { this.timer = setTimeout(resolve, this.d.backoffMs ?? 3000) })
    }
  }

  private handle(data: { inputs?: { inputName: string; inputLevelsMul: number[][] }[] }): void {
    const now = Date.now()
    if (now - this.lastPush < (this.d.throttleMs ?? 100)) return
    this.lastPush = now
    const levels: AudioLevels = { desktop: 0, mic: 0, game: 0 }
    for (const input of data.inputs ?? []) {
      const key = NAME_TO_KEY[input.inputName]
      if (!key) continue
      const peak = Math.max(0, ...(input.inputLevelsMul ?? []).map((ch) => ch[0] ?? 0))
      levels[key] = Math.min(1, peak)
    }
    this.d.onLevels(levels)
  }

  async stop(): Promise<void> {
    this.started = false
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    try { await this.client?.disconnect() } catch { /* ignore */ }
    this.client = null
  }
}
```

Note for the throttle test with `throttleMs: 0`: `now - lastPush < 0` is false, so every event pushes — intended. The first-event edge (lastPush 0) always pushes.
- [ ] **Step 4:** Both suites green (`npm -w @axistream/capture run test` AND app suite).
- [ ] **Step 5: Commit** — `feat(audio): sidecar wsInfo + volume-meter listener on a dedicated connection`.

---

### Task 3: renderer — backdrop video, contain switch, editor math

**Files:**
- Modify: `packages/app/src/renderer/components/PreviewVideo.tsx`, `packages/app/src/renderer/components/MaskEditor.tsx`, `packages/app/src/renderer/cover-transform.ts` (delete `coverContentRect`), `packages/app/src/renderer/styles.css`
- Test: `packages/app/test/cover-transform.test.ts` (drop cover tests), `packages/app/test/mask-editor.test.tsx` (unchanged behavior — layout stubs still yield the element-box fallback), `packages/app/test/preview-video.test.tsx` (new, minimal)

**Interfaces:**
- Consumes: `containContentRect` (Task 1).

- [ ] **Step 1: Failing test** — `packages/app/test/preview-video.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PreviewVideo } from '../src/renderer/components/PreviewVideo.js'

describe('PreviewVideo', () => {
  it('renders the blurred backdrop behind the contain preview', () => {
    const { container } = render(<PreviewVideo />)
    const videos = container.querySelectorAll('video')
    expect(videos).toHaveLength(2)
    expect(videos[0].className).toContain('preview-backdrop')
    expect(videos[1].className).toContain('preview-video')
  })
})
```

- [ ] **Step 2:** FAIL (one video today).
- [ ] **Step 3: Implement.**
  - `PreviewVideo.tsx`: add `const backRef = useRef<HTMLVideoElement>(null)`; wherever `ref.current.srcObject = stream` is assigned, also `if (backRef.current) { backRef.current.srcObject = stream; void backRef.current.play().catch(() => {}) }`; return becomes a fragment:

```tsx
  return (
    <>
      <video ref={backRef} className={`preview-backdrop${playing ? '' : ' loading'}`} autoPlay muted playsInline />
      <video ref={ref} className={`preview-video${playing ? '' : ' loading'}`} autoPlay muted playsInline onPlaying={() => setPlaying(true)} />
    </>
  )
```

  - `styles.css`: change `.preview-video` `object-fit: cover` → `contain`; add:

```css
/* Blurred letterbox backdrop — the same stream scaled to cover, blurred,
   so contain's bars read as a glow of the game instead of black. It touches
   the window corners, so it carries the self border-radius (see the
   hardware-overlay note above). */
.preview-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; filter: blur(28px) brightness(.55); border-radius: 0 10px 10px 0; opacity: 1; transition: opacity .35s ease; }
.preview-backdrop.loading { opacity: 0; }
```

  (Check the `.hero::after` loading-gradient selector `:has(.preview-video.loading)` still works — it keys off the front video, unchanged.)
  - `MaskEditor.tsx`: import + use `containContentRect` in `measure()` (drop `coverContentRect` import).
  - `cover-transform.ts`: delete `coverContentRect`; keep `CoverRect` + `containContentRect`. Drop the cover describe-block from `cover-transform.test.ts`.
- [ ] **Step 4:** Full suite green; typecheck zero.
- [ ] **Step 5: Commit** — `feat(ui): full-frame contain preview with blurred letterbox backdrop`.

---

### Task 4: fit button + meters wiring (main + state + UI)

**Files:**
- Modify: `packages/app/src/shared/state.ts`, `packages/app/src/main/ipc.ts`, `packages/app/src/preload/index.ts`, `packages/app/src/main/index.ts`, `packages/app/src/renderer/components/StreamScreen.tsx`, `packages/app/src/renderer/components/AudioSettings.tsx`, `packages/app/src/renderer/styles.css`
- Create: `packages/app/src/renderer/components/AudioPulse.tsx`
- Test: `packages/app/test/ipc-contract.test.ts` (append `fitWindowToCapture`), `packages/app/test/audio-pulse.test.tsx` (new), `packages/app/test/audio-settings.test.tsx` (append), `packages/app/test/stream-screen.test.tsx` (mock stub)

**Interfaces:**
- Consumes: `fitWidthForCapture` (T1), `AudioLevelMeter`/`AudioLevels`/`wsInfo` (T2).
- Produces: `CH.fitWindowToCapture = 'axi:fitWindowToCapture'`, `CH.evtAudioLevels = 'axi:evt:audioLevels'`; `AxiApi.fitWindowToCapture(): Promise<void>`; `AxiApi.onAudioLevels(cb: (l: AudioLevels) => void): () => void` (`AudioLevels` re-declared in `state.ts` as the shared shape and `AudioLevelMeter` imports it from there); `IpcHandlers.fitWindowToCapture(): Promise<void>`; `AudioPulse({ level }: { level: number })`.

- [ ] **Step 1: Failing tests.** ipc-contract gains `CH.fitWindowToCapture` (+ stub). `audio-pulse.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AudioPulse } from '../src/renderer/components/AudioPulse.js'

describe('AudioPulse', () => {
  it('is idle at level 0', () => {
    const { container } = render(<AudioPulse level={0} />)
    expect(container.firstElementChild!.className).not.toContain('live')
  })
  it('goes live above the threshold and scales bars', () => {
    const { container } = render(<AudioPulse level={0.5} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('live')
    expect(root.querySelectorAll('rect')).toHaveLength(3)
  })
})
```

Append to `audio-settings.test.tsx` (mock gains `onAudioLevels: vi.fn(() => () => {})`):

```tsx
  it('renders pulse meters on the desktop and mic rows and the apps divider', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" />)
    await screen.findByLabelText('Guild Wars 2')
    expect(document.querySelectorAll('.audio-pulse')).toHaveLength(3)
  })
```

- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement.**
  - `state.ts`: `export interface AudioLevels { desktop: number; mic: number; game: number }`; `CH.fitWindowToCapture`, `CH.evtAudioLevels`; `AxiApi.fitWindowToCapture` + `onAudioLevels`.
  - `AudioLevelMeter.ts`: switch its local `AudioLevels` to `import type { AudioLevels } from '../shared/state.js'` (re-export for its tests).
  - `ipc.ts`: `fitWindowToCapture(): Promise<void>` + zero-arg registration.
  - `preload/index.ts`: invoke one-liner + `onAudioLevels: (cb) => sub<AudioLevels>(CH.evtAudioLevels, cb)`.
  - `index.ts`: `const SIDEBAR_W = 200 // mirrors the CSS .sidebar width`; construct after `preview`:

```ts
  const meter = new AudioLevelMeter({ info: () => sidecar.wsInfo(), onLevels: (l) => push(CH.evtAudioLevels, l) })
```

  start it in the provisioned boot branch (after the probes: `meter.start()`) AND after a successful `provision` (first-run path, same place the virtual cam starts: add `meter.start()` — `start()` is idempotent). In the `win.on('close')` teardown add `void meter.stop()` next to `preview.stop()`. Handler:

```ts
    fitWindowToCapture: async () => {
      const cap = state.capture
      if (!cap) return
      const [, ch] = win.getContentSize()
      const wa = screen.getDisplayMatching(win.getBounds()).workArea
      win.setContentSize(fitWidthForCapture(SIDEBAR_W, ch, cap.width, cap.height, WINDOW_MIN.width, wa.width), ch)
    },
```

  (import `fitWidthForCapture` from `./window-size.js`.)
  - `AudioPulse.tsx`:

```tsx
export function AudioPulse({ level }: { level: number }) {
  const h = (f: number) => 3 + Math.min(1, level) * 9 * f
  return (
    <span className={`audio-pulse${level > 0.02 ? ' live' : ''}`} aria-hidden>
      <svg width="14" height="12" viewBox="0 0 14 12">
        <rect x="0" width="3" rx="1.5" y={12 - h(0.7)} height={h(0.7)} />
        <rect x="5.5" width="3" rx="1.5" y={12 - h(1)} height={h(1)} />
        <rect x="11" width="3" rx="1.5" y={12 - h(0.55)} height={h(0.55)} />
      </svg>
    </span>
  )
}
```

  - `AudioSettings.tsx`: `const [levels, setLevels] = useState<AudioLevels>({ desktop: 0, mic: 0, game: 0 })`; `useEffect(() => axi().onAudioLevels(setLevels), [])`; render `<AudioPulse level={levels.desktop} />` at the end of the All row, `<AudioPulse level={levels.game} />` in the divider (before the refresh button), `<AudioPulse level={levels.mic} />` in the mic row.
  - `StreamScreen.tsx`: floating fit button inside the hero, after the NEEDS_TITLE block:

```tsx
      {capture && phase !== 'SETTING_UP' ? (
        <button className="fit-btn" title="Fit window to game" onClick={() => axi.fitWindowToCapture()}><Scan size={14} /></button>
      ) : null}
```

  (add `Scan` to the lucide import; `stream-screen.test.tsx` mock gains `fitWindowToCapture: vi.fn()`.)
  - `styles.css`:

```css
/* Floating fit-to-capture button + audio pulse meters. */
.fit-btn { position: absolute; right: 12px; bottom: 92px; z-index: 4; width: 28px; height: 26px; border-radius: 8px; display: grid; place-items: center;
  color: #b9c4cf; background: rgba(0,0,0,.38); border: 1px solid rgba(255,255,255,.12); cursor: pointer; }
.fit-btn:hover { color: #22d3ee; background: rgba(0,0,0,.55); }
.audio-pulse { margin-left: auto; display: grid; place-items: center; }
.audio-pulse rect { fill: #3a4552; transition: height .12s ease, y .12s ease, fill .2s ease; }
.audio-pulse.live rect { fill: #22d3ee; }
.hear-divider .audio-pulse { margin-left: 0; }
```

  (In rows that already use `margin-left: auto` on other elements — the divider's refresh button — place the pulse before it and keep layout sane.)
- [ ] **Step 4:** Full suite green; typecheck zero.
- [ ] **Step 5: Commit** — `feat(ui): fit-window button + per-source audio pulse meters`.

---

## Final verification (whole branch)

- App + capture suites green; typecheck zero.
- Manual smoke (human): ultrawide capture → blurred bars, full frame visible, masks drawable everywhere; ⤢ removes bars; Discord noise pulses the apps meter, mic pulse follows speech.
