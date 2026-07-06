# V1 Robustness Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three independent hardening items: single-instance lock, stale audio-device fallback in the pickers, and truthful stream-health chips (real idle encoder label + dropped-frame severity).

**Architecture:** Each item is a small pure-testable unit plus thin wiring: `single-instance.ts` (injected Electron deps) gating `app.whenReady`; `device-options.ts` helper consumed by `AudioSettings`; `droppedPct` computed in `StreamController.mapStats` and an `AppState.encoder` field feeding `StatChips` severity styling. Spec: `docs/superpowers/specs/2026-07-06-v1-robustness-design.md`.

**Tech Stack:** Electron 31, React 18, TypeScript 5.5, Vitest 2 (+ @testing-library/react, jsdom).

## Global Constraints

- No new dependencies.
- Code style: 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on relative imports.
- Exact copy strings: stale option label `'Saved device (unavailable)'`; dropped chip suffix format `` `${stats.droppedFrames} dropped · ${stats.droppedPct}%` `` shown only when `droppedPct >= 1`.
- Severity thresholds: `bad` when `droppedPct > 5`, `warn` when `>= 1`, else `good`. `droppedPct` = `outputSkippedFrames / outputTotalFrames * 100` rounded to one decimal; `0` when total is 0/absent.
- `enforceSingleInstance` treats a throwing `requestSingleInstanceLock` as primary (worst case = today's behavior). Non-primary: `quit()` called, OBS never started.
- Test command: `npm -w @axistream/app run test`. Final typecheck gate: `cd packages/app && npx tsc --noEmit -p tsconfig.json` → zero errors.

---

## File Structure

**New:** `packages/app/src/main/single-instance.ts`, `packages/app/src/renderer/device-options.ts` (+ tests `single-instance.test.ts`, `device-options.test.ts`).
**Modified:** `src/main/index.ts` (Tasks 1, 4), `src/renderer/components/AudioSettings.tsx` (Task 2), `src/main/StreamController.ts` + `src/shared/state.ts` (Task 3), `src/renderer/components/StatChips.tsx` + `StreamScreen.tsx` + `styles.css` (Task 4), plus touched test files.

---

### Task 1: Single-instance lock

**Files:**
- Create: `packages/app/src/main/single-instance.ts`
- Modify: `packages/app/src/main/index.ts`
- Test: `packages/app/test/single-instance.test.ts`

**Interfaces:**
- Produces: `interface SingleInstanceDeps { requestSingleInstanceLock(): boolean; quit(): void; on(event: 'second-instance', cb: () => void): void }`; `enforceSingleInstance(d: SingleInstanceDeps, onSecondInstance: () => void): boolean`.

- [ ] **Step 1: Write the failing test** — `packages/app/test/single-instance.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { enforceSingleInstance } from '../src/main/single-instance.js'

function deps(lock: boolean | (() => boolean)) {
  const quit = vi.fn()
  const listeners: Record<string, () => void> = {}
  return {
    quit,
    listeners,
    d: {
      requestSingleInstanceLock: typeof lock === 'function' ? lock : () => lock,
      quit,
      on: (e: 'second-instance', cb: () => void) => { listeners[e] = cb },
    },
  }
}

describe('enforceSingleInstance', () => {
  it('primary: returns true, arms second-instance, never quits', () => {
    const t = deps(true)
    const onSecond = vi.fn()
    expect(enforceSingleInstance(t.d, onSecond)).toBe(true)
    expect(t.quit).not.toHaveBeenCalled()
    t.listeners['second-instance']()
    expect(onSecond).toHaveBeenCalledTimes(1)
  })

  it('secondary: quits and returns false', () => {
    const t = deps(false)
    expect(enforceSingleInstance(t.d, vi.fn())).toBe(false)
    expect(t.quit).toHaveBeenCalledTimes(1)
    expect(t.listeners['second-instance']).toBeUndefined()
  })

  it('throwing lock request is treated as primary', () => {
    const t = deps(() => { throw new Error('ipc down') })
    expect(enforceSingleInstance(t.d, vi.fn())).toBe(true)
    expect(t.quit).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/app run test -- test/single-instance.test.ts` → FAIL (module missing)
- [ ] **Step 3: Implement** — `packages/app/src/main/single-instance.ts`:

```ts
export interface SingleInstanceDeps {
  requestSingleInstanceLock(): boolean
  quit(): void
  on(event: 'second-instance', cb: () => void): void
}

/** True = this process owns the app (second-instance callback armed).
 *  False = another instance is running; quit() has been called and the
 *  caller must not start the engine. A throwing lock request is treated
 *  as primary — worst case is the old two-instance behavior. */
export function enforceSingleInstance(d: SingleInstanceDeps, onSecondInstance: () => void): boolean {
  let locked = true
  try { locked = d.requestSingleInstanceLock() } catch { return true }
  if (!locked) { d.quit(); return false }
  d.on('second-instance', onSecondInstance)
  return true
}
```

- [ ] **Step 4: Run to verify pass** — same command → 3 passed
- [ ] **Step 5: Wire into `index.ts`.**
  - Import: `import { enforceSingleInstance } from './single-instance.js'`
  - Immediately above the `app.whenReady().then(async () => {` line, add:

```ts
// A second AxiStream would spawn a second OBS against the same profile and
// collection — both break. Second launches just focus the first window.
let focusMain: () => void = () => {}
const primary = enforceSingleInstance({
  requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
  quit: () => app.quit(),
  on: (e, cb) => { app.on(e, cb) },
}, () => focusMain())
```

  - Change `app.whenReady().then(async () => {` to `if (primary) app.whenReady().then(async () => {` (body unchanged).
  - Inside the ready body, right after `const showWin = ...` is defined, add: `focusMain = showWin`

- [ ] **Step 6: Full suite + typecheck** — `npm -w @axistream/app run test` all pass; `cd packages/app && npx tsc --noEmit -p tsconfig.json` zero errors.
- [ ] **Step 7: Commit**

```bash
git add packages/app/src/main/single-instance.ts packages/app/test/single-instance.test.ts packages/app/src/main/index.ts
git commit -m "feat(app): single-instance lock — second launch focuses the first window"
```

---

### Task 2: Stale device fallback

**Files:**
- Create: `packages/app/src/renderer/device-options.ts`
- Modify: `packages/app/src/renderer/components/AudioSettings.tsx`
- Test: `packages/app/test/device-options.test.ts`, `packages/app/test/audio-settings.test.tsx` (append)

**Interfaces:**
- Produces: `interface DeviceOption { id: string; name: string }`; `staleOption(saved: string | null, devices: DeviceOption[]): DeviceOption | null`.

- [ ] **Step 1: Write the failing tests** — `packages/app/test/device-options.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { staleOption } from '../src/renderer/device-options.js'

const devs = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]

describe('staleOption', () => {
  it('null saved → null', () => { expect(staleOption(null, devs)).toBeNull() })
  it('empty-string saved → null', () => { expect(staleOption('', devs)).toBeNull() })
  it('saved present in list → null', () => { expect(staleOption('a', devs)).toBeNull() })
  it('saved missing → labeled placeholder with the saved id', () => {
    expect(staleOption('gone', devs)).toEqual({ id: 'gone', name: 'Saved device (unavailable)' })
  })
  it('empty device list + saved → placeholder', () => {
    expect(staleOption('gone', [])).toEqual({ id: 'gone', name: 'Saved device (unavailable)' })
  })
})
```

And append to `packages/app/test/audio-settings.test.tsx` (match its existing render/mocking pattern — it mocks the global `axi` and renders `<AudioSettings audio={...} />`):

```tsx
  it('renders an unavailable placeholder when the saved output device is not enumerated', async () => {
    // getDesktopDevices resolves to a list that does NOT contain the saved id
    // (adapt the axi mock the way the file's other desktop-device tests do)
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: 'unplugged-dac', micEnabled: false, micDevice: null }} />)
    expect(await screen.findByText('Saved device (unavailable)')).toBeInTheDocument()
    const select = screen.getByLabelText(/output device/i) as HTMLSelectElement
    expect(select.value).toBe('unplugged-dac')
  })
```

- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/app run test -- test/device-options.test.ts test/audio-settings.test.tsx` → FAIL
- [ ] **Step 3: Implement.**

`packages/app/src/renderer/device-options.ts`:

```ts
export interface DeviceOption { id: string; name: string }

/** When the saved device id isn't in the enumerated list (unplugged USB
 *  DAC), the bare <select value=...> matches no option and renders blank.
 *  This returns a labeled placeholder to render instead — OBS itself keeps
 *  working (it falls back internally when the id is gone). */
export function staleOption(saved: string | null, devices: DeviceOption[]): DeviceOption | null {
  if (!saved) return null
  if (devices.some((d) => d.id === saved)) return null
  return { id: saved, name: 'Saved device (unavailable)' }
}
```

`AudioSettings.tsx`: import `staleOption`; in each picker compute and render it as the first option. Desktop:

```tsx
{audio.desktopEnabled && (() => {
  const stale = staleOption(audio.desktopDevice, outputDevices)
  return (
    <label>Output device
      <select value={audio.desktopDevice ?? ''} onChange={(e) => axi().setDesktopDevice(e.target.value)}>
        {stale && <option value={stale.id}>{stale.name}</option>}
        {outputDevices.length === 0 && !stale && <option value="">No output devices found</option>}
        {outputDevices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </label>
  )
})()}
```

Mic picker: identical shape with `audio.micDevice` / `micDevices` / `setMicDevice` / `'No input devices found'`.

- [ ] **Step 4: Run to verify pass** — same command → all pass
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/renderer/device-options.ts packages/app/test/device-options.test.ts packages/app/src/renderer/components/AudioSettings.tsx packages/app/test/audio-settings.test.tsx
git commit -m "feat(ui): show saved-but-unplugged audio devices instead of a blank select"
```

---

### Task 3: droppedPct in LiveStats

**Files:**
- Modify: `packages/app/src/shared/state.ts`, `packages/app/src/main/StreamController.ts`
- Test: `packages/app/test/stream-controller.test.ts` (append)

**Interfaces:**
- Produces: `LiveStats.droppedPct: number` (percentage, one decimal, 0 when `outputTotalFrames` absent/0). Task 4 renders it.

- [ ] **Step 1: Write the failing test** — append inside the existing `describe('StreamController', ...)`:

```ts
  it('computes droppedPct from skipped/total frames', async () => {
    const c = clientFrom([{ outputActive: true, outputReconnecting: false, outputBytes: 1, outputSkippedFrames: 23, outputTotalFrames: 1000 }])
    const stats: any[] = []
    const sc = new StreamController({ client: c.client, onPhase: () => {}, onStats: (s) => stats.push(s), pollMs: 5 })
    await sc.goLive(ingest)
    await new Promise((r) => setTimeout(r, 30))
    await sc.stop()
    expect(stats[0].droppedPct).toBe(2.3)
  })

  it('droppedPct is 0 when total frames is absent', async () => {
    const c = clientFrom([{ outputActive: true, outputReconnecting: false, outputBytes: 1, outputSkippedFrames: 5 }])
    const stats: any[] = []
    const sc = new StreamController({ client: c.client, onPhase: () => {}, onStats: (s) => stats.push(s), pollMs: 5 })
    await sc.goLive(ingest)
    await new Promise((r) => setTimeout(r, 30))
    await sc.stop()
    expect(stats[0].droppedPct).toBe(0)
  })
```

- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/app run test -- test/stream-controller.test.ts` → new tests FAIL (droppedPct undefined)
- [ ] **Step 3: Implement.**
  - `state.ts`: add `droppedPct: number` to `LiveStats` (after `droppedFrames`).
  - `StreamController.mapStats`: near the top compute

```ts
    const total = Number(st.outputTotalFrames ?? 0)
    const skipped = Number(st.outputSkippedFrames ?? 0)
    const droppedPct = total > 0 ? Math.round((skipped / total) * 1000) / 10 : 0
```

  and add `droppedPct,` to BOTH returned stats objects (the first-sample branch and the normal branch).

- [ ] **Step 4: Run to verify pass** — same command → all pass. Typecheck note: `StatChips`/fixtures don't reference `droppedPct` yet, and `LiveStats` consumers build full objects only in `StreamController` — run `cd packages/app && npx tsc --noEmit -p tsconfig.json`; if any test fixture builds a `LiveStats` literal it now needs `droppedPct: 0` — fix those in this task.
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/main/StreamController.ts packages/app/test/stream-controller.test.ts
git commit -m "feat(stats): dropped-frame percentage in live stats"
```

(Include any fixture files you touched in the add.)

---

### Task 4: Truthful chips — idle encoder label + severity styling

**Files:**
- Modify: `packages/app/src/shared/state.ts`, `packages/app/src/main/index.ts`, `packages/app/src/renderer/components/StatChips.tsx`, `packages/app/src/renderer/components/StreamScreen.tsx`, `packages/app/src/renderer/styles.css`
- Test: `packages/app/test/stat-chips.test.tsx` (new), fixtures in `stream-screen.test.tsx`/`store.test.ts` if they hand-build state

**Interfaces:**
- Consumes: `LiveStats.droppedPct` (Task 3); `currentPreset` in `index.ts` (from the encoder-presets feature).
- Produces: `AppState.encoder: string` (INITIAL_STATE `'x264'`); `StatChips({ stats, capture, encoder })`.

- [ ] **Step 1: Write the failing tests** — `packages/app/test/stat-chips.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatChips } from '../src/renderer/components/StatChips.js'
import type { LiveStats, CaptureMeta } from '../src/shared/state.js'

const capture: CaptureMeta = { sourceLabel: 'GW2', width: 2560, height: 1440, outputWidth: 2560, outputHeight: 1440, fps: 60 }
const stats = (over: Partial<LiveStats> = {}): LiveStats => ({
  bitrateKbps: 9000, droppedFrames: 0, droppedPct: 0, durationMs: 1000,
  encoder: 'NVENC', cpuPct: 10, reconnecting: false, ...over,
})

describe('StatChips', () => {
  it('idle chip shows the passed encoder label, not a hardcoded one', () => {
    render(<StatChips stats={null} capture={capture} encoder="NVENC" />)
    expect(screen.getByText('NVENC · 1440p60')).toBeInTheDocument()
  })

  it('dropped chip is good below 1%', () => {
    render(<StatChips stats={stats({ droppedFrames: 3, droppedPct: 0.2 })} capture={capture} encoder="NVENC" />)
    expect(screen.getByText('3 dropped').className).toContain('good')
  })

  it('dropped chip warns at 1–5% and shows the percentage', () => {
    render(<StatChips stats={stats({ droppedFrames: 342, droppedPct: 2.3 })} capture={capture} encoder="NVENC" />)
    const chip = screen.getByText('342 dropped · 2.3%')
    expect(chip.className).toContain('warn')
    expect(chip.className).not.toContain('good')
  })

  it('dropped chip is bad above 5%', () => {
    render(<StatChips stats={stats({ droppedFrames: 900, droppedPct: 7.5 })} capture={capture} encoder="NVENC" />)
    expect(screen.getByText('900 dropped · 7.5%').className).toContain('bad')
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/app run test -- test/stat-chips.test.tsx` → FAIL (encoder prop unknown / hardcoded x264)
- [ ] **Step 3: Implement.**

`state.ts`: add `encoder: string` to `AppState`; `encoder: 'x264'` in `INITIAL_STATE`.

`index.ts`: in `applyEncoderPreset`, after `currentPreset = choosePreset(...)`, add `setState({ encoder: currentPreset.label })`. (`applyEncoderPreset` is declared before `setState`? No — `setState` is defined near the top of the ready body, before the controllers; both are in scope. The `onStartFailure` path already routes through `applyEncoderPreset`, so the label self-corrects on fallback.)

`StatChips.tsx` (full new body):

```tsx
import type { LiveStats, CaptureMeta } from '../../shared/state.js'

export function StatChips({ stats, capture, encoder }: { stats: LiveStats | null; capture: CaptureMeta | null; encoder: string }) {
  // Output resolution actually sent to YouTube (height-based label, e.g. 1440p60).
  const res = capture ? `${capture.outputHeight}p${capture.fps}` : '—'
  // Idle (not streaming): just the encoder. Live: full health row.
  if (!stats) {
    return (
      <div className="chips">
        <span className="chip">{encoder} · {res}</span>
      </div>
    )
  }
  const droppedClass = stats.droppedPct > 5 ? 'bad' : stats.droppedPct >= 1 ? 'warn' : 'good'
  const dropped = stats.droppedPct >= 1
    ? `${stats.droppedFrames} dropped · ${stats.droppedPct}%`
    : `${stats.droppedFrames} dropped`
  return (
    <div className="chips">
      <span className="chip">{`▲ ${stats.bitrateKbps} kbps`}</span>
      <span className={`chip ${droppedClass}`}>{dropped}</span>
      <span className="chip">{`${stats.encoder} · ${res}`}</span>
      <span className="chip">{`CPU ${stats.cpuPct}%`}</span>
    </div>
  )
}
```

`StreamScreen.tsx`: change the usage to `<StatChips stats={stats} capture={capture} encoder={state.encoder} />`.

`styles.css`: next to the existing `.chip.good` rule, add `warn`/`bad` variants mirroring its property set with amber/red (use the palette already in the file — e.g. if `.chip.good` sets a green color/border, copy the rule and swap to `#fbbf24`-family for `warn` and `#f87171`-family for `bad`).

- [ ] **Step 4: Fixtures.** Any hand-built `AppState` in tests needs `encoder: 'x264'` (most spread `INITIAL_STATE`); any hand-built `LiveStats` needs `droppedPct` (Task 3 may have caught these already — verify).
- [ ] **Step 5: Run everything** — `npm -w @axistream/app run test` all pass; `cd packages/app && npx tsc --noEmit -p tsconfig.json` zero errors.
- [ ] **Step 6: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/main/index.ts packages/app/src/renderer/components/StatChips.tsx packages/app/src/renderer/components/StreamScreen.tsx packages/app/src/renderer/styles.css packages/app/test/stat-chips.test.tsx
git commit -m "feat(ui): truthful health chips — real idle encoder label, dropped-frame severity"
```

(Include any fixture files you touched in the add.)

---

## Final verification (whole branch)

- `npm -w @axistream/app run test` green; `cd packages/app && npx tsc --noEmit -p tsconfig.json` zero errors.
- Manual smoke (human): second `npm run dev` exits and focuses the first window; unplug the selected USB output → picker shows "Saved device (unavailable)" instead of blank.
