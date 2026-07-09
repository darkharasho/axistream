# OAuth-only go-live with real live confirmation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OAuth path the only way to go live, and report LIVE only once YouTube confirms the broadcast is actually live.

**Architecture:** A generic `StreamController` change stops emitting LIVE until the `onIngestActive` hook resolves. A new pure `pollForLive` helper polls `confirmLive()`. `index.ts` wires it into go-live: show `STARTING_ON_YOUTUBE` while polling, then truthful `LIVE`, or `LIVE` + a `liveUnconfirmed` warning on timeout with a background poll that clears it. Manual stream-key mode is deleted entirely; the readiness gate flips from "has key" to "is signed in to YouTube".

**Tech Stack:** Electron + TypeScript (ESM/NodeNext, `.js` import extensions), React renderer, Vitest (fork pool capped at 2).

## Global Constraints

- Code style: 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on relative imports. Copied verbatim from CLAUDE.md.
- OBS calls are best-effort: `console.warn`, never throw out.
- Tests: `npm -w @axistream/app run test`. Typecheck gate: `cd packages/app && npx tsc --noEmit -p tsconfig.json`.
- Run vitest with fork pool capped at 2 (repo vitest.config already sets this — respect it).
- Timing constants injectable for tests: `confirmPollMs = 3000`, `confirmDeadlineMs = 45000` (→ 15 attempts); background re-poll `5000`ms.

---

### Task 1: Gate LIVE emission in StreamController until ingest is confirmed

**Files:**
- Modify: `packages/app/src/main/StreamController.ts:58-75`
- Test: `packages/app/test/stream-controller.test.ts` (create if absent; otherwise add to the existing StreamController test file — check with `ls packages/app/test | grep -i stream`)

**Interfaces:**
- Consumes: existing `StreamController` (`goLive`, `GoLiveHooks.onIngestActive`, `StreamDeps.onPhase`, `pollMs`, `startTries`).
- Produces: no signature change. Behavioral guarantee later tasks rely on: `onPhase('LIVE')` is NOT called until after `onIngestActive` resolves; `onStats` still fires each tick during the wait.

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/stream-controller.test.ts` (or append if a StreamController test file already exists):

```ts
import { describe, it, expect, vi } from 'vitest'
import { StreamController } from '../src/main/StreamController.js'

function client(states: any[]) {
  let i = 0
  return {
    call: vi.fn(async (req: string) => {
      if (req === 'GetStreamStatus') return states[Math.min(i++, states.length - 1)]
      return {}
    }),
  }
}

describe('StreamController LIVE gating', () => {
  it('does not emit LIVE while onIngestActive is pending, then emits after it resolves', async () => {
    const phases: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const c = client([{ outputActive: true, outputBytes: 1, outputTotalFrames: 1 }])
    const sc = new StreamController({
      client: () => c as any,
      onStats: () => {},
      onPhase: (p) => { phases.push(p) },
      pollMs: 5,
      startTries: 1,
    })
    await sc.goLive({ server: 's', key: 'k' }, { onIngestActive: async () => { await gate } })
    // Let several ticks fire while onIngestActive is still pending.
    await new Promise((r) => setTimeout(r, 40))
    expect(phases).not.toContain('LIVE')
    release()
    await new Promise((r) => setTimeout(r, 20))
    expect(phases).toContain('LIVE')
    await sc.stop()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run test/stream-controller.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — `phases` contains `'LIVE'` before `release()` (current code emits LIVE on line 73 from a concurrent tick).

- [ ] **Step 3: Apply the gate**

Replace `StreamController.ts` lines 66-74 (the `if (st.outputActive && !becameLive) { ... }` block through the trailing `onPhase`/`onStats`) with:

```ts
      if (st.outputActive && !becameLive) {
        becameLive = true
        try { await this.hooks.onIngestActive?.() }
        catch { await this.failStart(c, target, false); return }
        this.live = true
      }
      // Only claim LIVE once onIngestActive has resolved (this.live). Stats still
      // flow during the wait so the UI can show a real bitrate immediately.
      if (this.live) this.d.onPhase(st.outputReconnecting ? 'RECONNECTING' : 'LIVE')
      this.d.onStats(this.mapStats(st, pollMs))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/app && npx vitest run test/stream-controller.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/StreamController.ts packages/app/test/stream-controller.test.ts
git commit -m "fix(stream): don't emit LIVE until onIngestActive resolves

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `pollForLive` helper

**Files:**
- Create: `packages/app/src/main/pollForLive.ts`
- Test: `packages/app/test/poll-for-live.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PollForLiveDeps {
    confirm: () => Promise<boolean>
    pollMs: number
    maxAttempts: number            // Infinity for an unbounded background watch
    sleep?: (ms: number) => Promise<void>
    shouldStop?: () => boolean
  }
  export function pollForLive(d: PollForLiveDeps): Promise<boolean>
  ```
  Resolves `true` as soon as `confirm()` returns true; `false` if `shouldStop()` becomes true or `maxAttempts` is exhausted. `confirm()` rejections are swallowed (treated as `false`).

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/poll-for-live.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { pollForLive } from '../src/main/pollForLive.js'

const noSleep = async () => {}

describe('pollForLive', () => {
  it('resolves true as soon as confirm() succeeds', async () => {
    const confirm = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const ok = await pollForLive({ confirm, pollMs: 1, maxAttempts: 15, sleep: noSleep })
    expect(ok).toBe(true)
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('resolves false after maxAttempts without success', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const ok = await pollForLive({ confirm, pollMs: 1, maxAttempts: 3, sleep: noSleep })
    expect(ok).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(3)
  })

  it('treats a confirm() rejection as false and keeps polling', async () => {
    const confirm = vi.fn()
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce(true)
    const ok = await pollForLive({ confirm, pollMs: 1, maxAttempts: 5, sleep: noSleep })
    expect(ok).toBe(true)
  })

  it('stops early when shouldStop() becomes true', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    let stop = false
    const p = pollForLive({
      confirm, pollMs: 1, maxAttempts: Infinity,
      sleep: async () => { stop = true }, shouldStop: () => stop,
    })
    await expect(p).resolves.toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run test/poll-for-live.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — `Cannot find module '../src/main/pollForLive.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/app/src/main/pollForLive.ts`:

```ts
export interface PollForLiveDeps {
  confirm: () => Promise<boolean>
  pollMs: number
  maxAttempts: number
  sleep?: (ms: number) => Promise<void>
  shouldStop?: () => boolean
}

// Poll confirm() until it returns true (resolve true), shouldStop() flips
// (resolve false), or maxAttempts is exhausted (resolve false). confirm()
// rejections are swallowed and treated as "not live yet".
export async function pollForLive(d: PollForLiveDeps): Promise<boolean> {
  const sleep = d.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  for (let i = 0; i < d.maxAttempts; i++) {
    if (d.shouldStop?.()) return false
    if (await d.confirm().catch(() => false)) return true
    if (i < d.maxAttempts - 1) await sleep(d.pollMs)
  }
  return false
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/app && npx vitest run test/poll-for-live.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/pollForLive.ts packages/app/test/poll-for-live.test.ts
git commit -m "feat(golive): add pollForLive helper for broadcast confirmation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire live confirmation into go-live + LiveBadge UI

**Files:**
- Modify: `packages/app/src/shared/state.ts:3-5` (add `STARTING_ON_YOUTUBE`), `:27-45` (add `liveUnconfirmed`), `:46-59` (INITIAL_STATE)
- Modify: `packages/app/src/main/index.ts` — `goLive` `onIngestActive`/`onStop` (~415-433), `stopStream` (~441), add module-scoped watch cancellation
- Create: `packages/app/src/renderer/components/LiveBadge.tsx`
- Modify: `packages/app/src/renderer/components/StreamScreen.tsx:36-41` (use LiveBadge), `:59-88` (STARTING_ON_YOUTUBE button state)
- Test: `packages/app/test/live-badge.test.tsx`

**Interfaces:**
- Consumes: `pollForLive` (Task 2); `live.confirmLive(broadcastId): Promise<boolean>` (existing `YouTubeLive`).
- Produces:
  - `StreamPhase` gains `'STARTING_ON_YOUTUBE'` (keep `'NEEDS_KEY'` for now — removed in Task 4).
  - `AppState.liveUnconfirmed: boolean`.
  - `LiveBadge({ phase, liveUnconfirmed, durationMs })` component.

- [ ] **Step 1: Add the phase + state field (additive)**

In `packages/app/src/shared/state.ts`, change the `StreamPhase` union (lines 3-5) to add `STARTING_ON_YOUTUBE`:

```ts
export type StreamPhase =
  | 'SETTING_UP' | 'AWAITING_APPROVAL' | 'NEEDS_KEY' | 'NEEDS_TITLE' | 'READY'
  | 'GOING_LIVE' | 'STARTING_ON_YOUTUBE' | 'LIVE' | 'RECONNECTING' | 'ERROR'
```

Add `liveUnconfirmed: boolean` to the `AppState` interface (after `stats` on line 31):

```ts
  stats: LiveStats | null
  liveUnconfirmed: boolean
```

And to `INITIAL_STATE` (line 47), add `liveUnconfirmed: false`:

```ts
  phase: 'SETTING_UP', capture: null, keyMasked: null, stats: null, liveUnconfirmed: false, error: null,
```

- [ ] **Step 2: Write the failing LiveBadge test**

Create `packages/app/test/live-badge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LiveBadge } from '../src/renderer/components/LiveBadge.js'

describe('LiveBadge', () => {
  it('shows PREVIEW when not live', () => {
    render(<LiveBadge phase="READY" liveUnconfirmed={false} durationMs={0} />)
    expect(screen.getByText(/PREVIEW/)).toBeTruthy()
  })

  it('shows "Starting on YouTube" during STARTING_ON_YOUTUBE', () => {
    render(<LiveBadge phase="STARTING_ON_YOUTUBE" liveUnconfirmed={false} durationMs={0} />)
    expect(screen.getByText(/Starting on YouTube/i)).toBeTruthy()
  })

  it('shows a clean LIVE badge when confirmed', () => {
    render(<LiveBadge phase="LIVE" liveUnconfirmed={false} durationMs={5000} />)
    expect(screen.getByText('LIVE')).toBeTruthy()
    expect(screen.queryByText(/hasn.t started/i)).toBeNull()
  })

  it('shows a warning sub-line when live but unconfirmed', () => {
    render(<LiveBadge phase="LIVE" liveUnconfirmed={true} durationMs={5000} />)
    expect(screen.getByText(/hasn.t started your broadcast/i)).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/app && npx vitest run test/live-badge.test.tsx --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — module `LiveBadge.js` not found.

- [ ] **Step 4: Implement LiveBadge**

Create `packages/app/src/renderer/components/LiveBadge.tsx`:

```tsx
import type { StreamPhase } from '../../shared/state.js'

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000); const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function LiveBadge({ phase, liveUnconfirmed, durationMs }:
  { phase: StreamPhase; liveUnconfirmed: boolean; durationMs: number }) {
  const live = phase === 'LIVE' || phase === 'RECONNECTING'
  if (phase === 'STARTING_ON_YOUTUBE') {
    return <span className="badge starting">● Starting on YouTube…</span>
  }
  if (!live) return <span className="badge">● PREVIEW</span>
  return (
    <>
      <span className="badge live"><span aria-hidden>● </span>LIVE</span>
      <span className="pill mono">{fmt(durationMs)}</span>
      {liveUnconfirmed
        ? <span className="pill warn">YouTube hasn’t started your broadcast yet — check YouTube Studio</span>
        : null}
    </>
  )
}
```

- [ ] **Step 5: Use LiveBadge in StreamScreen**

In `packages/app/src/renderer/components/StreamScreen.tsx`, add the import (near line 6):

```tsx
import { LiveBadge } from './LiveBadge.js'
```

Replace lines 38-39 (the badge + duration pill) with:

```tsx
        <LiveBadge phase={phase} liveUnconfirmed={state.liveUnconfirmed} durationMs={stats?.durationMs ?? 0} />
```

Update the go-live button block (lines 79-88) so `STARTING_ON_YOUTUBE` reads as in-progress. Change the final `else` button's disabled/label logic:

```tsx
        {phase === 'NEEDS_KEY' ? (
          <KeyInput onSave={(k) => axi.saveKey(k)} />
        ) : live ? (
          <button className="btn danger action" onClick={() => axi.stopStream()}><Square size={16} /> End Stream</button>
        ) : (
          <button className="btn primary action"
            disabled={phase === 'GOING_LIVE' || phase === 'STARTING_ON_YOUTUBE'}
            onClick={() => axi.goLive()}>
            {phase === 'GOING_LIVE' ? 'Starting…'
              : phase === 'STARTING_ON_YOUTUBE' ? 'Starting on YouTube…'
              : <><Radio size={15} /> Go Live</>}
          </button>
        )}
```

Also add `STARTING_ON_YOUTUBE` to the status-row "hide switch/fit while busy" guard on line 62 (`live || phase === 'GOING_LIVE'` → `live || phase === 'GOING_LIVE' || phase === 'STARTING_ON_YOUTUBE'`).

- [ ] **Step 6: Wire confirmation into index.ts go-live**

In `packages/app/src/main/index.ts`:

Add the import near the other main imports (top of file, group with local `./` imports):

```ts
import { pollForLive } from './pollForLive.js'
```

Add a module-scoped cancellation flag next to the other go-live locals (near where `pendingOAuthBump` is declared — search for `pendingOAuthBump`):

```ts
let liveWatchStop = false
```

Replace the `onIngestActive` hook body (currently lines ~416-431, the `try { await live.confirmLive(...) } catch {}` plus the discord block) with:

```ts
          onIngestActive: async () => {
            setState({ phase: 'STARTING_ON_YOUTUBE', liveUnconfirmed: false })
            const confirmed = await pollForLive({
              confirm: () => live.confirmLive(session!.broadcastId),
              pollMs: 3000,
              maxAttempts: 15, // ~45s
            })
            setState({ liveUnconfirmed: !confirmed })
            if (!confirmed) {
              // Keep checking in the background; clear the warning if YouTube
              // starts the broadcast late. Cancelled by stopStream().
              liveWatchStop = false
              void pollForLive({
                confirm: () => live.confirmLive(session!.broadcastId),
                pollMs: 5000,
                maxAttempts: Infinity,
                shouldStop: () => liveWatchStop,
              }).then((late) => { if (late) setState({ liveUnconfirmed: false }) })
            }
            const cfg = settings.load()
            if (cfg.discordWebhookUrl.trim()) {
              void announce({
                webhookUrl: cfg.discordWebhookUrl,
                title,
                watchUrl: `https://www.youtube.com/watch?v=${session!.broadcastId}`,
                message: cfg.discordMessage,
              }, realFetch).catch(() => {})
            }
          },
```

In `stopStream` (line ~441) cancel the watch and clear the flag:

```ts
    stopStream: async () => { liveWatchStop = true; setState({ liveUnconfirmed: false }); await stream.stop() },
```

- [ ] **Step 7: Run the affected tests + typecheck**

Run: `cd packages/app && npx vitest run test/live-badge.test.tsx test/stream-controller.test.ts test/poll-for-live.test.ts --pool=forks --poolOptions.forks.maxForks=2 && npx tsc --noEmit -p tsconfig.json`
Expected: tests PASS; tsc clean. (Existing `stream-screen.test.tsx` may need a `liveUnconfirmed` field in its mock state — if tsc or that test flags it, add `liveUnconfirmed: false` to the mock `AppState`; full fix lands in Task 4.)

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/main/index.ts packages/app/src/main/pollForLive.ts packages/app/src/renderer/components/LiveBadge.tsx packages/app/src/renderer/components/StreamScreen.tsx packages/app/test/live-badge.test.tsx
git commit -m "feat(golive): confirm YouTube broadcast is live before showing LIVE

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Remove manual stream-key mode; flip readiness gate to OAuth

**Files:**
- Delete: `packages/app/src/main/KeyStore.ts`, `packages/app/src/renderer/components/KeyInput.tsx`, `packages/app/test/key-store.test.ts`
- Modify: `packages/app/src/shared/state.ts` (union, `keyMasked`, `CH.saveKey/forgetKey`, `AxiApi.saveKey/forgetKey`)
- Modify: `packages/app/src/main/index.ts` (lines 73, 181, 351, 388, 389-390, 394-396, 442, 454, 762 per enumeration)
- Modify: `packages/app/src/main/ipc.ts` (lines 7-8, 58-59), `packages/app/src/preload/index.ts` (lines 14-15)
- Modify: `packages/app/src/renderer/components/StreamScreen.tsx` (NEEDS_KEY block, keyMasked pill), `packages/app/src/renderer/components/SettingsScreen.tsx` (stream-key section)
- Modify: `packages/app/src/main/smoke.ts:25`
- Modify tests: `packages/app/test/store.test.ts`, `ipc-contract.test.ts`, `smoke.test.ts`, `stream-screen.test.tsx`, `settings-screen.test.tsx`

**Interfaces:**
- Consumes: `auth.isConnected()` (existing `YouTubeAuth`).
- Produces: `NEEDS_KEY` removed; `NEEDS_YOUTUBE` added to `StreamPhase`. `keyMasked`, `saveKey`, `forgetKey`, `CH.saveKey`, `CH.forgetKey` removed. `goReadyPhase` now returns `'READY' | 'NEEDS_YOUTUBE'`.

- [ ] **Step 1: Update the smoke test first (drives the rename)**

In `packages/app/test/smoke.test.ts`, find the assertion(s) expecting `NEEDS_KEY` as a success phase and change them to `NEEDS_YOUTUBE`. Run it to confirm it now fails against current `smoke.ts`:

Run: `cd packages/app && npx vitest run test/smoke.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL (smoke.ts still emits/accepts `NEEDS_KEY`).

- [ ] **Step 2: Update state.ts**

- Union (lines 3-5): replace `NEEDS_KEY` with `NEEDS_YOUTUBE`:
  ```ts
  export type StreamPhase =
    | 'SETTING_UP' | 'AWAITING_APPROVAL' | 'NEEDS_YOUTUBE' | 'NEEDS_TITLE' | 'READY'
    | 'GOING_LIVE' | 'STARTING_ON_YOUTUBE' | 'LIVE' | 'RECONNECTING' | 'ERROR'
  ```
- Remove `keyMasked: string | null` from `AppState` (line 30) and from `INITIAL_STATE` (line 47).
- Remove `saveKey: 'axi:saveKey',` and `forgetKey: 'axi:forgetKey',` from `CH` (lines 79-80).
- Remove `saveKey(key: string): Promise<void>` and `forgetKey(): Promise<void>` from `AxiApi` (lines 131-132).

- [ ] **Step 3: Update smoke.ts**

`packages/app/src/main/smoke.ts:25` — replace `NEEDS_KEY` with `NEEDS_YOUTUBE`:

```ts
      if (phase === 'READY' || phase === 'NEEDS_YOUTUBE' || phase === 'NEEDS_TITLE') {
```

- [ ] **Step 4: Update index.ts**

- Delete line 73 (`const YT_RTMPS = ...`).
- Delete the `KeyStore` import (line 30) and line 181 (`const keyStore = new KeyStore(...)`).
- Line 351: `const goReadyPhase = () => auth.isConnected() ? 'READY' : 'NEEDS_YOUTUBE'`
- Remove `keyMasked: keyStore.masked(),` from the setState calls on lines 388, 442, 454.
- Delete the `saveKey` and `forgetKey` handlers (lines 389-390).
- Replace the go-live not-connected branch (lines 392-398) with:
  ```ts
      if (!auth.isConnected()) { setState({ phase: 'NEEDS_YOUTUBE' }); return }
  ```
  (Delete the `const key = keyStore.load()` / `stream.goLive({ server: YT_RTMPS, key })` lines entirely.)
- Line 762: `setState({ phase: goReadyPhase(), capture: capture_ })` (drop `keyMasked`).
- In the `connectYouTube` handler (line 456-461), after setting connected, also advance the phase if we were gated: change the final `setState` to:
  ```ts
      setState({ youtube: { connected: true, channel: title }, phase: state.phase === 'NEEDS_YOUTUBE' ? 'READY' : state.phase })
  ```
- In `disconnectYouTube` (462-465), gate back if idle:
  ```ts
      setState({ youtube: { connected: false, channel: null }, phase: state.phase === 'READY' ? 'NEEDS_YOUTUBE' : state.phase })
  ```

- [ ] **Step 5: Update ipc.ts and preload**

- `ipc.ts`: delete `saveKey`/`forgetKey` from `IpcHandlers` (lines 7-8) and the two `ipcMain.handle(CH.saveKey…)`/`CH.forgetKey` registrations (lines 58-59).
- `preload/index.ts`: delete the `saveKey` and `forgetKey` lines (14-15).

- [ ] **Step 6: Update the renderer**

- `StreamScreen.tsx`: delete the `KeyInput` import (line 7) and the `Key` icon import if now unused. Remove `keyMasked` from the destructure (line 18). Delete the `keyMasked` pill (line 74). Replace the `phase === 'NEEDS_KEY' ? <KeyInput .../>` branch (lines 79-80) with a connect prompt:
  ```tsx
        {phase === 'NEEDS_YOUTUBE' ? (
          <button className="btn primary action" onClick={() => axi.connectYouTube()}>
            <Radio size={15} /> Connect YouTube to go live
          </button>
        ) : live ? (
  ```
- `SettingsScreen.tsx`: delete the `KeyInput` import (line 2) and the entire "Stream key (advanced fallback)" `<section>` (lines 26-36).

- [ ] **Step 7: Delete dead files + their tests**

```bash
git rm packages/app/src/main/KeyStore.ts packages/app/src/renderer/components/KeyInput.tsx packages/app/test/key-store.test.ts
```

- [ ] **Step 8: Fix remaining tests**

- `test/store.test.ts`, `test/ipc-contract.test.ts`, `test/stream-screen.test.tsx`, `test/settings-screen.test.tsx`: remove references to `keyMasked`, `saveKey`, `forgetKey`, `NEEDS_KEY`. Where a mock `AppState` is built, drop `keyMasked` and ensure `liveUnconfirmed: false` is present. Where `stream-screen.test.tsx` asserted the `NEEDS_KEY`/KeyInput path, assert the `NEEDS_YOUTUBE` "Connect YouTube to go live" button instead. Where `ipc-contract.test.ts` enumerates channels/handlers, remove `saveKey`/`forgetKey`.

- [ ] **Step 9: Run full typecheck + suite**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json && npm run test`
Expected: tsc clean; all tests pass. Fix any lingering `NEEDS_KEY`/`keyMasked`/`saveKey` references the compiler flags until green.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(golive): remove manual stream-key mode; gate go-live on YouTube sign-in

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Full verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Full gates**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json && npm run test`
Then: `npm -w @axistream/capture run test`
Expected: all green.

- [ ] **Step 2: Build the app bundle**

Run: `cd packages/app && npm run build`
Expected: builds without error.

- [ ] **Step 3: Manual smoke (documented, user-run)**

With no `yt-tokens.bin`, launch: app lands on `NEEDS_YOUTUBE` ("Connect YouTube to go live"). Connect → phase `READY`. Go live → observe `STARTING_ON_YOUTUBE` ("Starting on YouTube…") then `LIVE` only after YouTube confirms; verify the broadcast appears on the channel. (If YouTube is slow, confirm the `liveUnconfirmed` warning shows and later clears.)

- [ ] **Step 4: Finish the branch**

Use `superpowers:finishing-a-development-branch` to merge `feat/oauth-only-golive` into `main` with a `Merge feat/oauth-only-golive: ...` commit.

---

## Self-Review

**Spec coverage:**
- Removal of key-mode (§Scope) → Task 4. ✓
- Readiness gate flip (§1) → Task 4 Steps 4/6. ✓
- Live confirmation + STARTING_ON_YOUTUBE + timeout warning + background clear (§2) → Task 3. ✓
- StreamController gate (§3) → Task 1. ✓
- State additions (§4) → Task 3 Step 1 (additive) + Task 4 Step 2 (removals). ✓
- UI (§5) → Task 3 Steps 4-5 + Task 4 Step 6. ✓
- Testing (§Testing) → Tasks 1-4 tests. ✓
- Verification (§Verification) → Task 5. ✓

**Placeholder scan:** No TBD/TODO; all code steps show full code. ✓

**Type consistency:** `pollForLive`/`PollForLiveDeps` signatures match between Task 2 and Task 3 Step 6. `LiveBadge` prop names (`phase`, `liveUnconfirmed`, `durationMs`) match between Task 3 Step 2 test, Step 4 impl, and Step 5 usage. `STARTING_ON_YOUTUBE`/`NEEDS_YOUTUBE`/`liveUnconfirmed` spelled identically throughout. ✓
