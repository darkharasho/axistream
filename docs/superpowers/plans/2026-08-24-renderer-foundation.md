# Renderer Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AxiStream renderer a non-fatal error channel (toasts), make a renderer crash recoverable without endangering a live stream (nested error boundaries), and establish the focus/keyboard baseline.

**Architecture:** A module-level toast store consumed via `useSyncExternalStore` — the same pattern `store.ts` already uses, deliberately not React Context, which this codebase does not use anywhere. Main pushes discrete events over a new `evtToast` channel mirroring the existing `evtUpdateStatus` shape. Error boundaries nest root-plus-per-screen so a Settings crash cannot cost a user the End Stream button.

**Tech Stack:** Electron 31, React 18, TypeScript (ESM/NodeNext), Vitest + jsdom + @testing-library/react, lucide-react.

**Spec:** `docs/superpowers/specs/2026-08-24-renderer-foundation-design.md`

## Global Constraints

- **Code style:** 2-space indent, **no semicolons**, single quotes, named exports, `.js` extensions on all relative imports (ESM/NodeNext). No linter is configured — match surrounding code by hand.
- **Governing rule for the toast channel:** conditions live in `AppState`; the toast channel carries **only discrete events**. Do not wire the best-effort OBS warning layer to toasts.
- **Errors are sticky.** `info` and `success` auto-dismiss at **4000ms**; `error` never auto-dismisses. Stack caps at **3**, evicting oldest.
- **Clipboard is main-process only.** Use `axi.copyToClipboard`, never `navigator.clipboard` — that shortcut was walked back in PR #12.
- **No "Restart app" button** in any crash UI, even though `relaunchApp` exists.
- **Main-process pushes are best-effort** — `console.warn`, never throw out.
- **Gates before merge:** `npm -w @axistream/app run test`, `npm -w @axistream/capture run test`, `cd packages/app && npx tsc --noEmit -p tsconfig.json`.
- **Test runner:** vitest fork pool is already capped at 2 in `packages/app/vitest.config.ts`. Do not raise it.
- Work happens on the existing branch `feat/renderer-foundation`.

## Deviation from the spec, decided during planning

The spec's call-site table lists four sites without fixing the mechanism. Three (Discord announce, game-audio plugin install, blur plugin install) are pushed from main, because main is where the event occurs and the renderer has no other way to learn about it.

The fourth — **updater errors — is raised renderer-side instead**, in `App.tsx`'s existing `onUpdateStatus` subscription. `UpdateStatus` already streams to the renderer on its own channel and `App.tsx` already subscribes; adding a parallel main-side push would duplicate an existing transport for no gain. The user-visible outcome is identical: update failures become visible regardless of which screen is open.

---

### Task 1: Toast store

**Files:**
- Create: `packages/app/src/renderer/toasts.ts`
- Modify: `packages/app/src/shared/state.ts` (append types near `UpdateStatus`)
- Test: `packages/app/test/toasts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ToastKind = 'info' | 'success' | 'error'`, `ToastPayload { kind, message, detail? }`, `Toast extends ToastPayload { id: string }` — all exported from `src/shared/state.ts`.
  - `createToastStore()` and singleton `toastStore` from `src/renderer/toasts.ts`, with `subscribe(fn) => () => void`, `getToasts() => Toast[]`, `push(payload) => string`, `dismiss(id) => void`.
  - Constants `TOAST_TTL_MS = 4000`, `MAX_TOASTS = 3`.

- [ ] **Step 1: Add the shared types**

In `packages/app/src/shared/state.ts`, directly above the existing `/** Update lifecycle pushed to the renderer... */` comment block:

```ts
/** One-off notification. Discrete events only — conditions belong in AppState. */
export type ToastKind = 'info' | 'success' | 'error'
export interface ToastPayload {
  kind: ToastKind
  /** Human-readable, one line. */
  message: string
  /** Technical string (OBS error, HTTP status), rendered smaller beneath the message. */
  detail?: string
}
export interface Toast extends ToastPayload { id: string }
```

- [ ] **Step 2: Write the failing test**

Create `packages/app/test/toasts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createToastStore, TOAST_TTL_MS, MAX_TOASTS } from '../src/renderer/toasts.js'

describe('toast store', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('push returns an id and exposes the toast', () => {
    const s = createToastStore()
    const id = s.push({ kind: 'info', message: 'hello' })
    expect(s.getToasts()).toEqual([{ id, kind: 'info', message: 'hello' }])
  })

  it('notifies subscribers on push and on dismiss', () => {
    const s = createToastStore()
    const fn = vi.fn()
    s.subscribe(fn)
    const id = s.push({ kind: 'info', message: 'hello' })
    expect(fn).toHaveBeenCalledTimes(1)
    s.dismiss(id)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not notify when dismissing an unknown id', () => {
    const s = createToastStore()
    const fn = vi.fn()
    s.subscribe(fn)
    s.dismiss('nope')
    expect(fn).not.toHaveBeenCalled()
  })

  it('auto-dismisses info after the TTL', () => {
    const s = createToastStore()
    s.push({ kind: 'info', message: 'hello' })
    vi.advanceTimersByTime(TOAST_TTL_MS - 1)
    expect(s.getToasts()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(s.getToasts()).toHaveLength(0)
  })

  it('auto-dismisses success after the TTL', () => {
    const s = createToastStore()
    s.push({ kind: 'success', message: 'done' })
    vi.advanceTimersByTime(TOAST_TTL_MS)
    expect(s.getToasts()).toHaveLength(0)
  })

  it('never auto-dismisses errors', () => {
    const s = createToastStore()
    s.push({ kind: 'error', message: 'boom', detail: 'HTTP 500' })
    vi.advanceTimersByTime(TOAST_TTL_MS * 10)
    expect(s.getToasts()).toHaveLength(1)
  })

  it('dismisses an error explicitly', () => {
    const s = createToastStore()
    const id = s.push({ kind: 'error', message: 'boom' })
    s.dismiss(id)
    expect(s.getToasts()).toHaveLength(0)
  })

  it('evicts the oldest beyond the cap', () => {
    const s = createToastStore()
    for (let i = 0; i < MAX_TOASTS + 2; i++) s.push({ kind: 'error', message: `m${i}` })
    expect(s.getToasts()).toHaveLength(MAX_TOASTS)
    expect(s.getToasts()[0].message).toBe('m2')
  })

  it('returns a stable array reference between mutations', () => {
    const s = createToastStore()
    s.push({ kind: 'error', message: 'a' })
    expect(s.getToasts()).toBe(s.getToasts())
  })

  it('unsubscribe stops notifications', () => {
    const s = createToastStore()
    const fn = vi.fn()
    const off = s.subscribe(fn)
    off()
    s.push({ kind: 'info', message: 'hello' })
    expect(fn).not.toHaveBeenCalled()
  })
})
```

The stable-reference test matters: `useSyncExternalStore` re-renders infinitely if `getToasts()` returns a fresh array each call.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm -w @axistream/app run test -- toasts`
Expected: FAIL — cannot resolve `../src/renderer/toasts.js`.

- [ ] **Step 4: Write the implementation**

Create `packages/app/src/renderer/toasts.ts`:

```ts
import type { Toast, ToastPayload } from '../shared/state.js'

/** Info and success clear themselves; errors do not (see push). */
export const TOAST_TTL_MS = 4000
/** Beyond this the oldest is evicted, so a burst can't bury the UI. */
export const MAX_TOASTS = 3

export function createToastStore() {
  let toasts: Toast[] = []
  let seq = 0
  const subs = new Set<() => void>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const notify = () => subs.forEach((f) => f())

  const clearTimer = (id: string) => {
    const t = timers.get(id)
    if (t) { clearTimeout(t); timers.delete(id) }
  }

  const dismiss = (id: string) => {
    clearTimer(id)
    const next = toasts.filter((t) => t.id !== id)
    if (next.length === toasts.length) return
    toasts = next
    notify()
  }

  return {
    subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn) } },
    // Identity only changes on mutation — useSyncExternalStore requires this.
    getToasts: () => toasts,
    dismiss,
    push(payload: ToastPayload): string {
      const id = `t${++seq}`
      toasts = [...toasts, { ...payload, id }]
      while (toasts.length > MAX_TOASTS) {
        clearTimer(toasts[0].id)
        toasts = toasts.slice(1)
      }
      // Errors are sticky: one that vanishes before it's read is no error at all.
      if (payload.kind !== 'error') timers.set(id, setTimeout(() => dismiss(id), TOAST_TTL_MS))
      notify()
      return id
    },
  }
}

export type ToastStore = ReturnType<typeof createToastStore>
export const toastStore = createToastStore()
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm -w @axistream/app run test -- toasts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/toasts.ts packages/app/src/shared/state.ts packages/app/test/toasts.test.ts
git commit -m "feat(renderer): add toast store"
```

---

### Task 2: ToastHost component and styles

**Files:**
- Create: `packages/app/src/renderer/components/ToastHost.tsx`
- Modify: `packages/app/src/renderer/styles.css`
- Test: `packages/app/test/toast-host.test.tsx`

**Interfaces:**
- Consumes: `toastStore`, `ToastStore` from Task 1.
- Produces: `ToastHost({ store? }: { store?: ToastStore })` — the `store` prop exists solely so tests can inject an isolated store; app code renders `<ToastHost />` with no props.

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/toast-host.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ToastHost } from '../src/renderer/components/ToastHost.js'
import { createToastStore } from '../src/renderer/toasts.js'

describe('ToastHost', () => {
  it('renders nothing when empty', () => {
    const store = createToastStore()
    const { container } = render(<ToastHost store={store} />)
    expect(container.firstChild).toBeNull()
  })

  it('uses role=alert for errors', () => {
    const store = createToastStore()
    act(() => { store.push({ kind: 'error', message: 'Update failed' }) })
    render(<ToastHost store={store} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Update failed')
  })

  it('uses role=status for info and success', () => {
    const store = createToastStore()
    act(() => { store.push({ kind: 'success', message: 'Plugin installed' }) })
    render(<ToastHost store={store} />)
    expect(screen.getByRole('status')).toHaveTextContent('Plugin installed')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders detail when present', () => {
    const store = createToastStore()
    act(() => { store.push({ kind: 'error', message: 'Announce failed', detail: 'HTTP 401' }) })
    render(<ToastHost store={store} />)
    expect(screen.getByText('HTTP 401')).toBeTruthy()
  })

  it('omits detail when absent', () => {
    const store = createToastStore()
    act(() => { store.push({ kind: 'error', message: 'Announce failed' }) })
    const { container } = render(<ToastHost store={store} />)
    expect(container.querySelector('.toast-detail')).toBeNull()
  })

  it('dismiss control removes the toast', () => {
    const store = createToastStore()
    act(() => { store.push({ kind: 'error', message: 'Announce failed' }) })
    render(<ToastHost store={store} />)
    act(() => { screen.getByRole('button', { name: /dismiss/i }).click() })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('re-renders when a toast arrives after mount', () => {
    const store = createToastStore()
    render(<ToastHost store={store} />)
    act(() => { store.push({ kind: 'error', message: 'Late arrival' }) })
    expect(screen.getByRole('alert')).toHaveTextContent('Late arrival')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @axistream/app run test -- toast-host`
Expected: FAIL — cannot resolve `ToastHost.js`.

- [ ] **Step 3: Write the component**

Create `packages/app/src/renderer/components/ToastHost.tsx`:

```tsx
import { useSyncExternalStore } from 'react'
import { Info, CheckCircle2, AlertCircle, X } from 'lucide-react'
import { toastStore, type ToastStore } from '../toasts.js'

const ICONS = { info: Info, success: CheckCircle2, error: AlertCircle }

export function ToastHost({ store = toastStore }: { store?: ToastStore }) {
  const toasts = useSyncExternalStore(store.subscribe, store.getToasts)
  if (!toasts.length) return null
  return (
    <div className="toasts">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind]
        return (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <Icon size={15} className="toast-icon" />
            <div className="toast-body">
              <span className="toast-msg">{t.message}</span>
              {t.detail ? <span className="toast-detail">{t.detail}</span> : null}
            </div>
            <button className="toast-x" aria-label="Dismiss notification" onClick={() => store.dismiss(t.id)}>
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Add the styles**

Append to `packages/app/src/renderer/styles.css`. Placement is constrained on three sides — bottom-centre is `.overlay` (`z-index: 3`) and the `hero-bottom` control block, top-right is `.wctl` (`z-index: 10`), and the top 46px strip is `.dragbar` (`z-index: 5`). So: top-right, offset below the window controls, `z-index: 8`, and `no-drag` because it sits inside the drag strip's band.

```css
/* Toast stack — discrete events only (conditions use .overlay). Sits below
   .wctl so window controls stay clickable, above .overlay and the preview.
   Inside the .dragbar band, so it must opt out of window dragging. */
.toasts { position: absolute; top: 44px; right: 11px; z-index: 8; display: flex; flex-direction: column; gap: 8px; max-width: 340px; -webkit-app-region: no-drag; }
.toast { display: flex; align-items: flex-start; gap: 9px; padding: 10px 11px; border-radius: 10px; background: rgba(12,15,20,.92); border: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: 0 6px 20px rgba(0,0,0,.45); }
.toast .toast-icon { flex: none; margin-top: 1px; }
.toast.info .toast-icon { color: #7ee3f2; }
.toast.success .toast-icon { color: #56d364; }
.toast.error { border-color: rgba(240,85,107,.45); }
.toast.error .toast-icon { color: #f85149; }
.toast-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.toast-msg { font-size: 13px; line-height: 1.35; color: #e6edf3; }
/* Technical detail is selectable — users paste it to us. */
.toast-detail { font: 11px/1.4 ui-monospace, monospace; color: #8b949e; word-break: break-word; -webkit-user-select: text; user-select: text; }
.toast-x { flex: none; margin-left: auto; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; color: #8b949e; background: none; border: 0; cursor: pointer; }
.toast-x:hover { color: #fff; background: rgba(255,255,255,.1); }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm -w @axistream/app run test -- toast-host`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/components/ToastHost.tsx packages/app/src/renderer/styles.css packages/app/test/toast-host.test.tsx
git commit -m "feat(renderer): add ToastHost with live-region roles"
```

---

### Task 3: evtToast IPC channel

**Files:**
- Create: `packages/app/src/main/toast.ts`
- Modify: `packages/app/src/shared/state.ts` (`CH` map and `AxiApi`), `packages/app/src/preload/index.ts`
- Test: `packages/app/test/ipc-contract.test.ts` (extend), `packages/app/test/main-toast.test.ts` (create)

**Interfaces:**
- Consumes: `ToastPayload` from Task 1.
- Produces:
  - `CH.evtToast = 'axi:evt:toast'`
  - `AxiApi.onToast(cb: (t: ToastPayload) => void): () => void`
  - `toast(win: { isDestroyed(): boolean; webContents: { send(ch: string, p: unknown): void } } | null, payload: ToastPayload): void` from `src/main/toast.ts`. Structurally typed rather than `BrowserWindow` so it is unit-testable without Electron.

- [ ] **Step 1: Add the channel and the API entry**

In `packages/app/src/shared/state.ts`, add to the `CH` object next to `evtUpdateStatus`:

```ts
  evtToast: 'axi:evt:toast',
```

And to the `AxiApi` interface, next to `onUpdateStatus`:

```ts
  onToast(cb: (t: ToastPayload) => void): () => void
```

- [ ] **Step 2: Expose it in preload**

In `packages/app/src/preload/index.ts`, add `type ToastPayload` to the existing import from `'../shared/state.js'`, then add to the `api` object beside `onUpdateStatus`:

```ts
  onToast: (cb) => sub<ToastPayload>(CH.evtToast, cb),
```

- [ ] **Step 3: Write the failing test for the main helper**

Create `packages/app/test/main-toast.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { toast } from '../src/main/toast.js'
import { CH } from '../src/shared/state.js'

const fakeWin = (destroyed = false) => ({
  isDestroyed: () => destroyed,
  webContents: { send: vi.fn() },
})

describe('main toast helper', () => {
  it('sends the payload on the toast channel', () => {
    const win = fakeWin()
    toast(win, { kind: 'error', message: 'Announce failed', detail: 'HTTP 401' })
    expect(win.webContents.send).toHaveBeenCalledWith(CH.evtToast, {
      kind: 'error', message: 'Announce failed', detail: 'HTTP 401',
    })
  })

  it('is a no-op when the window is null', () => {
    expect(() => toast(null, { kind: 'info', message: 'x' })).not.toThrow()
  })

  it('is a no-op when the window is destroyed', () => {
    const win = fakeWin(true)
    toast(win, { kind: 'info', message: 'x' })
    expect(win.webContents.send).not.toHaveBeenCalled()
  })

  it('never throws out when send fails', () => {
    const win = { isDestroyed: () => false, webContents: { send: () => { throw new Error('gone') } } }
    expect(() => toast(win, { kind: 'info', message: 'x' })).not.toThrow()
  })
})
```

That last case is the project's best-effort rule: a renderer push must never take down a main-process code path.

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm -w @axistream/app run test -- main-toast`
Expected: FAIL — cannot resolve `../src/main/toast.js`.

- [ ] **Step 5: Write the main helper**

Create `packages/app/src/main/toast.ts`:

```ts
import { CH, type ToastPayload } from '../shared/state.js'

/** Minimal structural shape of what we need from a BrowserWindow, so this
    helper is unit-testable without Electron. */
export interface ToastTarget {
  isDestroyed(): boolean
  webContents: { send(channel: string, payload: unknown): void }
}

/**
 * Push a one-off notification to the renderer.
 *
 * Conditions belong in AppState; this channel carries discrete events only.
 * Best-effort like every other renderer push — it warns and never throws out,
 * so no go-live or capture path can fail because of a notification.
 */
export function toast(win: ToastTarget | null, payload: ToastPayload): void {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(CH.evtToast, payload)
  } catch (e) {
    console.warn('[toast] failed to push', e)
  }
}
```

- [ ] **Step 6: Extend the IPC contract test**

In `packages/app/test/ipc-contract.test.ts`, add this case inside the existing `describe('ipc contract', ...)` block:

```ts
  it('defines a dedicated event channel for toasts', () => {
    expect(CH.evtToast).toBe('axi:evt:toast')
    // Event channel, not a command — registerIpc must not claim a handler for it.
    const handled = new Set<string>()
    registerIpc({
      ipcMain: { handle: (ch: string) => handled.add(ch) } as any,
      handlers: {} as any,
      bindPush: () => {},
    })
    expect(handled.has(CH.evtToast)).toBe(false)
  })
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm -w @axistream/app run test -- main-toast ipc-contract`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: no errors. If `onToast` is reported missing on the preload `api` object, the `AxiApi` entry from Step 1 was not added.

- [ ] **Step 9: Commit**

```bash
git add packages/app/src/main/toast.ts packages/app/src/shared/state.ts packages/app/src/preload/index.ts packages/app/test/main-toast.test.ts packages/app/test/ipc-contract.test.ts
git commit -m "feat(ipc): add evtToast channel and main-side toast helper"
```

---

### Task 4: Mount ToastHost and wire the call sites

**Files:**
- Modify: `packages/app/src/renderer/App.tsx`, `packages/app/src/main/index.ts`

**Interfaces:**
- Consumes: `toastStore` (Task 1), `ToastHost` (Task 2), `toast` and `AxiApi.onToast` (Task 3).
- Produces: nothing new. This is wiring only.

- [ ] **Step 1: Mount the host and subscribe in App.tsx**

In `packages/app/src/renderer/App.tsx`:

Add imports:

```tsx
import { ToastHost } from './components/ToastHost.js'
import { toastStore } from './toasts.js'
```

Replace the `axi.onUpdateStatus(setUpdate),` line in the `offs` array with:

```tsx
      axi.onUpdateStatus((s) => {
        setUpdate(s)
        // Update failures otherwise render only inside UpdatesSettings — invisible
        // unless the user happens to be sitting on the Settings screen.
        if (s.state === 'error') toastStore.push({ kind: 'error', message: 'Update failed', detail: s.message })
      }),
      axi.onToast((t) => { toastStore.push(t) }),
```

Add `<ToastHost />` inside the top-level `<div className="app">`, immediately after `<div className="dragbar" />`:

```tsx
      <ToastHost />
```

- [ ] **Step 2: Wire the Discord announce failure in main**

In `packages/app/src/main/index.ts`, add to the imports:

```ts
import { toast } from './toast.js'
```

Replace the announce block (currently at roughly lines 473–481) with:

```ts
            const cfg = settings.load()
            if (cfg.discordWebhookUrl.trim()) {
              void announce({
                webhookUrl: cfg.discordWebhookUrl,
                title,
                watchUrl: watchUrlFor(session!.broadcastId),
                message: cfg.discordMessage,
              }, realFetch)
                .then((r) => {
                  if (!r.ok) toast(win, { kind: 'error', message: 'Discord announcement failed', detail: r.error })
                })
                .catch((e) => {
                  toast(win, { kind: 'error', message: 'Discord announcement failed', detail: String(e) })
                })
            }
```

The announce stays detached (`void`) — it must not be awaited before the LIVE transition.

- [ ] **Step 3: Wire the plugin install handlers in main**

In `packages/app/src/main/index.ts`, replace the two install handlers (currently at roughly lines 592–603):

```ts
    installGameAudioPlugin: async () => {
      if (state.gameAudioPlugin.status === 'installing') return
      setState({ gameAudioPlugin: { status: 'installing', error: null } })
      const r = await installer.install()
      setState({ gameAudioPlugin: r.ok ? { status: 'installed', error: null } : { status: 'error', error: r.error ?? 'Install failed' } })
      // Installs finish in the background, often on another screen.
      toast(win, r.ok
        ? { kind: 'success', message: 'Game audio plugin installed' }
        : { kind: 'error', message: 'Game audio plugin install failed', detail: r.error })
    },
    installBlurPlugin: async () => {
      if (state.blurPlugin.status === 'installing') return
      setState({ blurPlugin: { status: 'installing', error: null } })
      const r = await blurInstaller.install()
      setState({ blurPlugin: r.ok ? { status: 'installed', error: null } : { status: 'error', error: r.error ?? 'Install failed' } })
      toast(win, r.ok
        ? { kind: 'success', message: 'Blur plugin installed' }
        : { kind: 'error', message: 'Blur plugin install failed', detail: r.error })
    },
```

The `status` field in `AppState` remains the source of truth for the condition; the toast is the discrete event. Both are correct — that is the rule working as intended, not duplication.

- [ ] **Step 4: Verify `win` is in scope at all three call sites**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: no errors. `win` is the `BrowserWindow` already closed over by `push` at `src/main/index.ts:142`; if any handler is defined outside that closure, pass the window through the same way `push` is reached rather than widening scope.

- [ ] **Step 5: Run the full app suite**

Run: `npm -w @axistream/app run test`
Expected: PASS, including the pre-existing suites.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/App.tsx packages/app/src/main/index.ts
git commit -m "feat: surface update, announce, and plugin-install failures as toasts"
```

---

### Task 5: Export the store singleton

**Files:**
- Modify: `packages/app/src/renderer/store.ts`, `packages/app/src/renderer/App.tsx`
- Test: `packages/app/test/store.test.ts` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `store` — a module-level singleton exported from `src/renderer/store.ts`. `createStore` stays exported for tests. Task 6's error boundary reads `store.getState().phase` through this.

- [ ] **Step 1: Write the failing test**

Add to `packages/app/test/store.test.ts`:

```ts
  it('exports a module-level singleton', async () => {
    const a = await import('../src/renderer/store.js')
    const b = await import('../src/renderer/store.js')
    expect(a.store).toBe(b.store)
    expect(a.store.getState().phase).toBe('SETTING_UP')
  })
```

Add `store` to that file's existing import from `'../src/renderer/store.js'` if it imports named bindings directly.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @axistream/app run test -- store`
Expected: FAIL — `store` is undefined.

- [ ] **Step 3: Add the singleton**

At the end of `packages/app/src/renderer/store.ts`, after the existing `export type Store` line:

```ts
/** App-wide singleton. Exported (rather than constructed in App.tsx) so
    non-React code — notably ErrorBoundary, which renders outside the
    useSyncExternalStore tree — can read the current phase. */
export const store = createStore()
```

- [ ] **Step 4: Use it in App.tsx**

In `packages/app/src/renderer/App.tsx`, change:

```tsx
import { createStore } from './store.js'
```

to:

```tsx
import { store } from './store.js'
```

and delete the line `const store = createStore()`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm -w @axistream/app run test -- store`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/store.ts packages/app/src/renderer/App.tsx packages/app/test/store.test.ts
git commit -m "refactor(renderer): export the store singleton from store.ts"
```

---

### Task 6: ErrorBoundary component

**Files:**
- Create: `packages/app/src/renderer/components/ErrorBoundary.tsx`
- Modify: `packages/app/src/renderer/styles.css`
- Test: `packages/app/test/error-boundary.test.tsx`

**Interfaces:**
- Consumes: `store` (Task 5), `AxiApi.appVersion` and `AxiApi.copyToClipboard` (both already exist).
- Produces: `ErrorBoundary({ label, root?, children })`.

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/error-boundary.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ErrorBoundary } from '../src/renderer/components/ErrorBoundary.js'
import { store } from '../src/renderer/store.js'

const Boom = ({ fail }: { fail: boolean }) => {
  if (fail) throw new Error('kaboom')
  return <div>all good</div>
}

let copyToClipboard: ReturnType<typeof vi.fn>
let appVersion: ReturnType<typeof vi.fn>

beforeEach(() => {
  copyToClipboard = vi.fn().mockResolvedValue(true)
  appVersion = vi.fn().mockResolvedValue('1.0.0')
  ;(globalThis as any).axi = { copyToClipboard, appVersion }
  // React logs caught errors; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  store.applyState({ phase: 'READY' })
})
afterEach(() => { vi.restoreAllMocks() })

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(<ErrorBoundary label="Stream"><Boom fail={false} /></ErrorBoundary>)
    expect(screen.getByText('all good')).toBeTruthy()
  })

  it('renders the fallback with the label when a child throws', () => {
    render(<ErrorBoundary label="Settings"><Boom fail={true} /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent(/Something broke in Settings/i)
  })

  it('reassures the user when live that the stream is still running', () => {
    store.applyState({ phase: 'LIVE' })
    render(<ErrorBoundary label="Settings"><Boom fail={true} /></ErrorBoundary>)
    expect(screen.getByText(/stream is still running/i)).toBeTruthy()
  })

  it('reassures the user while reconnecting too', () => {
    store.applyState({ phase: 'RECONNECTING' })
    render(<ErrorBoundary label="Settings"><Boom fail={true} /></ErrorBoundary>)
    expect(screen.getByText(/stream is still running/i)).toBeTruthy()
  })

  it('does not claim a stream is running when not live', () => {
    store.applyState({ phase: 'READY' })
    render(<ErrorBoundary label="Settings"><Boom fail={true} /></ErrorBoundary>)
    expect(screen.queryByText(/stream is still running/i)).toBeNull()
  })

  it('shows the error message', () => {
    render(<ErrorBoundary label="Stream"><Boom fail={true} /></ErrorBoundary>)
    expect(screen.getByText(/kaboom/)).toBeTruthy()
  })

  it('offers no restart-app action', () => {
    render(<ErrorBoundary label="Stream"><Boom fail={true} /></ErrorBoundary>)
    expect(screen.queryByRole('button', { name: /restart/i })).toBeNull()
  })

  it('Reload recovers the subtree for a non-root boundary', () => {
    const { rerender } = render(<ErrorBoundary label="Settings"><Boom fail={true} /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toBeTruthy()
    rerender(<ErrorBoundary label="Settings"><Boom fail={false} /></ErrorBoundary>)
    act(() => { screen.getByRole('button', { name: /reload/i }).click() })
    expect(screen.getByText('all good')).toBeTruthy()
  })

  it('copies error details through the main-process clipboard', async () => {
    render(<ErrorBoundary label="Stream"><Boom fail={true} /></ErrorBoundary>)
    await act(async () => { screen.getByRole('button', { name: /copy error details/i }).click() })
    expect(copyToClipboard).toHaveBeenCalledTimes(1)
    const payload = copyToClipboard.mock.calls[0][0] as string
    expect(payload).toContain('kaboom')
    expect(payload).toContain('1.0.0')
    expect(payload).toContain('Stream')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @axistream/app run test -- error-boundary`
Expected: FAIL — cannot resolve `ErrorBoundary.js`.

- [ ] **Step 3: Write the component**

Create `packages/app/src/renderer/components/ErrorBoundary.tsx`:

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { store } from '../store.js'
import type { AxiApi } from '../../shared/state.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi

interface Props {
  /** Human name of the region this guards — shown in the fallback. */
  label: string
  /** Root boundaries reload the window; screen boundaries reset their subtree. */
  root?: boolean
  children: ReactNode
}
interface State { error: Error | null; stack: string }

/**
 * Catches renderer render errors.
 *
 * The framing matters: main owns OBS, so a renderer crash does NOT stop the
 * stream. The user is very likely still broadcasting and has simply lost
 * visibility, so the fallback leads with that and never offers a restart —
 * restarting is the one action most likely to actually cost them a broadcast.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ stack: info.componentStack ?? '' })
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info.componentStack)
  }

  private reset = (): void => {
    // Main is untouched either way; App's mount effect re-syncs through
    // getInitialState once the subtree remounts.
    if (this.props.root) { window.location.reload(); return }
    this.setState({ error: null, stack: '' })
  }

  private copy = async (): Promise<void> => {
    const version = await axi().appVersion().catch(() => 'unknown')
    const body = [
      `AxiStream ${version}`,
      `${this.props.label}: ${this.state.error?.message ?? 'unknown error'}`,
      this.state.stack,
    ].join('\n')
    // Main-process clipboard, not navigator.clipboard (see PR #12).
    await axi().copyToClipboard(body).catch(() => false)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    const phase = store.getState().phase
    const live = phase === 'LIVE' || phase === 'RECONNECTING'
    return (
      <div className="hero crash" role="alert">
        <h2>Something broke in {this.props.label}.</h2>
        {live ? <p className="crash-live">Your stream is still running.</p> : null}
        <p className="crash-msg">{error.message}</p>
        <div className="crash-actions">
          <button className="btn primary" onClick={this.reset}>Reload</button>
          <button className="btn ghost" onClick={() => void this.copy()}>Copy error details</button>
        </div>
      </div>
    )
  }
}
```

- [ ] **Step 4: Add the styles**

Append to `packages/app/src/renderer/styles.css`:

```css
/* Renderer crash fallback. Reuses .hero's centred layout. */
.crash { gap: 10px; text-align: center; }
.crash h2 { margin: 0; font-size: 17px; }
.crash-live { margin: 0; font-size: 13px; color: #56d364; }
/* Selectable — the whole point is that the user can hand it to us. */
.crash-msg { margin: 0; max-width: 460px; font: 11px/1.5 ui-monospace, monospace; color: #8b949e; word-break: break-word; -webkit-user-select: text; user-select: text; }
.crash-actions { display: flex; gap: 8px; margin-top: 4px; }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm -w @axistream/app run test -- error-boundary`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/components/ErrorBoundary.tsx packages/app/src/renderer/styles.css packages/app/test/error-boundary.test.tsx
git commit -m "feat(renderer): add live-aware ErrorBoundary"
```

---

### Task 7: Mount the boundaries

**Files:**
- Modify: `packages/app/src/renderer/App.tsx`
- Test: `packages/app/test/app-boundaries.test.tsx` (create)

**Interfaces:**
- Consumes: `ErrorBoundary` (Task 6).
- Produces: nothing new.

- [ ] **Step 1: Wrap the screens and the shell**

In `packages/app/src/renderer/App.tsx`, add:

```tsx
import { ErrorBoundary } from './components/ErrorBoundary.js'
```

Wrap each screen individually, so a Settings crash leaves the sidebar, the live badge, and End Stream intact:

```tsx
      {nav === 'stream'
        ? <ErrorBoundary label="Stream"><StreamScreen state={state} preview={preview} axi={axi} store={store} /></ErrorBoundary>
        : <ErrorBoundary label="Settings"><SettingsScreen state={state} axi={axi} /></ErrorBoundary>}
```

Then wrap the whole returned tree in a root boundary as backstop for crashes in the sidebar or shell:

```tsx
  return (
    <ErrorBoundary label="AxiStream" root>
      <div className="app">
        {/* ...existing contents unchanged... */}
      </div>
    </ErrorBoundary>
  )
```

- [ ] **Step 2: Write the test**

Create `packages/app/test/app-boundaries.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '../src/renderer/components/ErrorBoundary.js'
import { Sidebar } from '../src/renderer/components/Sidebar.js'
import { store } from '../src/renderer/store.js'

const Boom = () => { throw new Error('settings exploded') }

beforeEach(() => {
  ;(globalThis as any).axi = { copyToClipboard: vi.fn(), appVersion: vi.fn().mockResolvedValue('1.0.0') }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

describe('screen-level boundaries', () => {
  it('a crashed screen leaves the sidebar and live controls mounted', () => {
    store.applyState({ phase: 'LIVE' })
    const state = store.getState()
    render(
      <div className="app">
        <Sidebar active="settings" state={state} onNav={() => {}} axi={(globalThis as any).axi} />
        <ErrorBoundary label="Settings"><Boom /></ErrorBoundary>
      </div>
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/Something broke in Settings/i)
    // The sidebar survived: its live indicator is still on screen.
    expect(screen.getByText(/On air/i)).toBeTruthy()
  })
})
```

This asserts the actual reason per-screen boundaries were chosen over a single root one. If `Sidebar` needs additional props to render, pass them from `store.getState()` rather than hand-building a partial state.

- [ ] **Step 3: Run the test to verify it passes**

Run: `npm -w @axistream/app run test -- app-boundaries`
Expected: PASS.

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npm -w @axistream/app run test && cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/renderer/App.tsx packages/app/test/app-boundaries.test.tsx
git commit -m "feat(renderer): nest root and per-screen error boundaries"
```

---

### Task 8: Modal keyboard behaviour

**Files:**
- Create: `packages/app/src/renderer/use-modal-keys.ts`
- Modify: `packages/app/src/renderer/components/TitlePromptModal.tsx`, `packages/app/src/renderer/components/MaskEditor.tsx`
- Test: `packages/app/test/modal-keys.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `useModalKeys(ref: RefObject<HTMLElement | null>, onClose: () => void): void`.

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/modal-keys.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { useRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { useModalKeys } from '../src/renderer/use-modal-keys.js'

function Modal({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useModalKeys(ref, onClose)
  return (
    <div ref={ref}>
      <button>first</button>
      <button>last</button>
    </div>
  )
}

describe('useModalKeys', () => {
  it('Escape invokes onClose', () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys', () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('wraps Tab from the last focusable back to the first', () => {
    render(<Modal onClose={() => {}} />)
    const last = screen.getByText('last')
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByText('first'))
  })

  it('wraps Shift+Tab from the first focusable to the last', () => {
    render(<Modal onClose={() => {}} />)
    screen.getByText('first').focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByText('last'))
  })

  it('restores focus to the previously focused element on unmount', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const { unmount } = render(<Modal onClose={() => {}} />)
    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('does not re-run its effect when onClose identity changes', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const { rerender } = render(<Modal onClose={() => {}} />)
    screen.getByText('last').focus()
    // A fresh inline callback each render must not tear down and restore focus.
    rerender(<Modal onClose={() => {}} />)
    expect(document.activeElement).toBe(screen.getByText('last'))
    trigger.remove()
  })
})
```

That final case guards the specific bug this hook invites: callers pass inline arrow functions, so a naive `[onClose]` dependency re-runs the effect every render and yanks focus back to the trigger mid-interaction.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @axistream/app run test -- modal-keys`
Expected: FAIL — cannot resolve `use-modal-keys.js`.

- [ ] **Step 3: Write the hook**

Create `packages/app/src/renderer/use-modal-keys.ts`:

```ts
import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Escape-to-close, focus trapping, and focus restoration for a modal region.
 *
 * onClose is held in a ref rather than declared as a dependency: callers pass
 * inline arrow functions, so a dependency would re-run the effect on every
 * render and restore focus to the trigger mid-interaction.
 */
export function useModalKeys(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  const cb = useRef(onClose)
  cb.current = onClose

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); cb.current(); return }
      if (e.key !== 'Tab') return
      const nodes = ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!nodes || nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      const inside = ref.current?.contains(active as Node) ?? false
      if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [ref])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm -w @axistream/app run test -- modal-keys`
Expected: PASS, 6 tests.

- [ ] **Step 5: Apply to TitlePromptModal**

Rewrite `packages/app/src/renderer/components/TitlePromptModal.tsx`:

```tsx
import { useRef, useState } from 'react'
import type { AxiApi } from '../../shared/state.js'
import { useModalKeys } from '../use-modal-keys.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi

export function TitlePromptModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useModalKeys(ref, onClose)
  const submit = () => { if (!title.trim()) return; axi().goLive(title.trim()).catch(console.error); onClose() }
  return (
    <div className="modal-backdrop">
      <div className="modal" ref={ref} role="dialog" aria-modal="true" aria-label="Name your stream">
        <h3>Name your stream</h3>
        <input autoFocus type="text" value={title} placeholder="Stream title"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button disabled={!title.trim()} onClick={submit}>Go Live</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Apply to MaskEditor**

In `packages/app/src/renderer/components/MaskEditor.tsx`: add `useRef` to the existing React import, add `import { useModalKeys } from '../use-modal-keys.js'`, attach a `ref` to the editor's outermost element, and call `useModalKeys(ref, onDone)` — `onDone` is the prop the existing Done button already calls.

MaskEditor is a large panel currently leavable only by locating Done with a mouse, so Escape is the substantive win here.

- [ ] **Step 7: Run the affected suites**

Run: `npm -w @axistream/app run test -- modal-keys mask-editor`
Expected: PASS. The existing `mask-editor.test.tsx` must still pass unchanged — if attaching the ref changed the DOM structure it queries, restore the structure rather than editing the test.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/renderer/use-modal-keys.ts packages/app/src/renderer/components/TitlePromptModal.tsx packages/app/src/renderer/components/MaskEditor.tsx packages/app/test/modal-keys.test.tsx
git commit -m "feat(a11y): Escape, focus trap, and focus restore for modals"
```

---

### Task 9: Focus ring and field-error unification

**Files:**
- Modify: `packages/app/src/renderer/styles.css`, `packages/app/src/renderer/components/YouTubeSettings.tsx`, `packages/app/src/renderer/components/AudioSettings.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: the `.field-err` CSS class, replacing `.yt-test-err`, `.ptt-err`, and `.audio-test-err`.

- [ ] **Step 1: Add the global focus ring**

In `packages/app/src/renderer/styles.css`, add near the top (after the `body` rules, before the `#root` block):

```css
/* Keyboard focus baseline. :focus-visible only — pointer users don't see it. */
:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; border-radius: 6px; }
```

- [ ] **Step 2: Replace the three duplicate error classes**

The three are byte-identical today (`font-size: 12px; font-weight: 600; color: #f85149`). Delete these three rules:

```css
.yt-test-err { font-size: 12px; font-weight: 600; color: #f85149; }
.ptt-err { font-size: 12px; font-weight: 600; color: #f85149; }
.audio-test-err { font-size: 12px; font-weight: 600; color: #f85149; }
```

and add one:

```css
/* Inline failure attached to a specific control. Discrete background events
   use toasts instead; phase-level conditions use .overlay. */
.field-err { font-size: 12px; font-weight: 600; color: #f85149; }
```

`.setup-error` is deliberately **not** folded in — it is large hero text in a different colour (`#fecdd3`) serving a different context.

- [ ] **Step 3: Keep the error text selectable**

In `styles.css` line 10, update the `user-select` list, replacing the three old class names with the new one:

```css
.overlay-pill, .field-err, .yt-preview { -webkit-user-select: text; user-select: text; }
```

- [ ] **Step 4: Update the consumers**

- `YouTubeSettings.tsx`: in the `className={status.state === 'error' ? 'yt-test-err' : 'muted'}` expression and the Discord test result element, change `yt-test-err` to `field-err`.
- `AudioSettings.tsx`: change `audio-test-err` (the test-failure span) and `ptt-err` (the PTT error line) to `field-err`.

Run `grep -rn "yt-test-err\|ptt-err\|audio-test-err" packages/app/src` afterwards and confirm it returns nothing.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm -w @axistream/app run test && cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: PASS. If `audio-settings.test.tsx` or a sibling asserts on an old class name, update the test — the class rename is intentional.

- [ ] **Step 6: Audit icon-only buttons for labels**

Run: `grep -rn "<button" packages/app/src/renderer/components/*.tsx packages/app/src/renderer/App.tsx`

For each button whose children are only a lucide icon (no text node), confirm it has `aria-label` or `title`. Already verified during design: `.wctl` window controls and the sidebar quick toggles are covered. Add `aria-label` to any that are not. Expected to be a small pass; if it turns up more than a handful, note it and keep the additions mechanical.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/renderer/styles.css packages/app/src/renderer/components/YouTubeSettings.tsx packages/app/src/renderer/components/AudioSettings.tsx
git commit -m "feat(a11y): global focus ring, unify field error styles"
```

---

### Task 10: Verification and merge

**Files:** none modified.

- [ ] **Step 1: Run every gate**

```bash
npm -w @axistream/app run test
npm -w @axistream/capture run test
cd packages/app && npx tsc --noEmit -p tsconfig.json
```

Expected: all PASS. Do not proceed on a failure — fix it.

- [ ] **Step 2: Run the build gate**

```bash
npm run build
```

Expected: succeeds. This catches renderer/main bundling problems that the jsdom suites cannot — the same class of problem that made the copy-link feature need PR #12.

- [ ] **Step 3: Manual smoke**

Run `npm run dev` and confirm:
- A toast appears top-right without covering the window controls, and minimise/close remain clickable while one is showing.
- An error toast stays until dismissed; a success toast disappears on its own after about four seconds.
- Escape closes the title prompt and the mask editor; focus returns to the control that opened them.
- Tabbing anywhere shows a visible cyan focus ring.
- Trigger the game-audio or blur plugin install and confirm the completion toast fires while on another screen.

- [ ] **Step 4: Merge**

```bash
git checkout main
git merge --no-ff feat/renderer-foundation -m "Merge feat/renderer-foundation: toasts, error boundaries, a11y floor"
```

---

## Self-review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Toast store, dismissal policy, cap | 1 |
| Toast host, placement, live-region roles | 2 |
| `evtToast` channel, preload, main helper | 3 |
| Four wired call sites | 4 (updater renderer-side — see deviation note) |
| Store singleton refactor | 5 |
| Error boundary, live-aware copy, Reload, Copy details, no Restart | 6 |
| Root + per-screen nesting | 7 |
| `useModalKeys` on both modals | 8 |
| Global `:focus-visible`, `.field-err`, icon-label audit | 9 |
| All merge gates | 10 |

No spec requirement is unassigned.

**Placeholder scan:** every code step carries real code. The two prose-directed steps (8.6 MaskEditor ref attachment, 9.6 icon audit) are edits to files whose exact current shape the implementer must read first; both name the precise symbols involved and the verification command.

**Type consistency:** `ToastPayload`/`Toast`/`ToastKind` defined in Task 1 and used unchanged in Tasks 2, 3, 4. `createToastStore`/`toastStore`/`ToastStore` consistent across 1, 2, 4. `toast(win, payload)` defined in 3, called in 4. `store` singleton produced in 5, consumed in 6 and 7. `useModalKeys(ref, onClose)` defined in 8, applied twice in the same task.
