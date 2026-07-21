# Copy Livestream Link Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Copy link" button to the live UI that copies the current YouTube broadcast's watch URL to the clipboard.

**Architecture:** After an OAuth go-live, the main process learns `session.broadcastId` and stores the watch URL in `AppState.watchUrl`. The value rides the existing `CH.evtState` push to the renderer (no new IPC). `StreamScreen` renders a copy button whenever `watchUrl` is non-null; it persists after the stream ends and is only overwritten by the next go-live. A shared pure helper `watchUrlFor()` builds the URL for both the button and the existing Discord announce.

**Tech Stack:** Electron + React (renderer), TypeScript (ESM/NodeNext, `.js` import extensions), vitest (fork pool ≤2), lucide-react icons.

## Global Constraints

- Code style: 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on relative imports. No linter.
- Tests run from `packages/app`: `npm -w @axistream/app run test`. Test files live under `packages/app/test/**` and import source via `../src/...js`.
- Typecheck gate: `cd packages/app && npx tsc --noEmit -p tsconfig.json`.
- OBS/YouTube calls are best-effort — never throw out of the go-live path.
- This is the app's **first** clipboard usage; use renderer-side `navigator.clipboard.writeText` (no new preload/IPC surface).
- Go-live is OAuth-only (the handler returns `NEEDS_YOUTUBE` when not connected), so every successful go-live has a real broadcast; there is no pasted-key branch to guard.

---

### Task 1: Shared `watchUrlFor` helper (with test)

Extract the watch-URL construction — currently an inline template at `main/index.ts:433` — into one tested pure function, exported from the YouTube module so both the go-live handler and the Discord announce reuse it.

**Files:**
- Modify: `packages/app/src/main/YouTubeLive.ts` (add exported function near top, after line 6)
- Modify: `packages/app/src/main/index.ts:433` (use the helper in the Discord announce call)
- Test: `packages/app/test/youtube-live.test.ts` (append a describe block)

**Interfaces:**
- Produces: `watchUrlFor(broadcastId: string): string` — returns `https://www.youtube.com/watch?v=<broadcastId>`. Exported from `./YouTubeLive.js`.

- [ ] **Step 1: Write the failing test**

Append to `packages/app/test/youtube-live.test.ts` (add `watchUrlFor` to the existing import from `../src/main/YouTubeLive.js`):

```ts
import { watchUrlFor } from '../src/main/YouTubeLive.js'

describe('watchUrlFor', () => {
  it('builds a YouTube watch URL from a broadcast id', () => {
    expect(watchUrlFor('abc123')).toBe('https://www.youtube.com/watch?v=abc123')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @axistream/app run test -- youtube-live`
Expected: FAIL — `watchUrlFor` is not exported / not a function.

- [ ] **Step 3: Write minimal implementation**

In `packages/app/src/main/YouTubeLive.ts`, after line 6 (the `LiveSession` interface), add:

```ts
export function watchUrlFor(broadcastId: string): string {
  return `https://www.youtube.com/watch?v=${broadcastId}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @axistream/app run test -- youtube-live`
Expected: PASS.

- [ ] **Step 5: Reuse the helper in the Discord announce call**

In `packages/app/src/main/index.ts`, add `watchUrlFor` to the existing `./YouTubeLive.js` import (the file already imports the `LiveSession` type from it via inline `import(...)`; add a top-level named import if one is not already present):

```ts
import { watchUrlFor } from './YouTubeLive.js'
```

Then replace line 433:

```ts
                watchUrl: `https://www.youtube.com/watch?v=${session!.broadcastId}`,
```

with:

```ts
                watchUrl: watchUrlFor(session!.broadcastId),
```

- [ ] **Step 6: Typecheck and commit**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

```bash
git add packages/app/src/main/YouTubeLive.ts packages/app/src/main/index.ts packages/app/test/youtube-live.test.ts
git commit -m "refactor: extract watchUrlFor helper, reuse in Discord announce"
```

---

### Task 2: Carry `watchUrl` in AppState and set it at go-live

Add the `watchUrl` field to shared state and populate it in the main process the moment a broadcast exists.

**Files:**
- Modify: `packages/app/src/shared/state.ts` (`AppState` interface line 27-45; `INITIAL_STATE` line 46-59)
- Modify: `packages/app/src/main/index.ts` (`goLive` handler, after `startSession` at line 403-404)

**Interfaces:**
- Consumes: `watchUrlFor(broadcastId)` from Task 1.
- Produces: `AppState.watchUrl: string | null` — pushed to the renderer over `CH.evtState`.

- [ ] **Step 1: Add the field to the AppState interface**

In `packages/app/src/shared/state.ts`, inside `interface AppState` (after line 44 `masksVisible: boolean`), add:

```ts
  watchUrl: string | null
```

- [ ] **Step 2: Initialize it**

In `INITIAL_STATE` (after line 58 `masksVisible: true,`), add:

```ts
  watchUrl: null,
```

- [ ] **Step 3: Set watchUrl at go-live**

In `packages/app/src/main/index.ts`, in the `goLive` handler, immediately after line 404 (`settings.patch({ streamId: session.streamId })`), add:

```ts
        setState({ watchUrl: watchUrlFor(session.broadcastId) })
```

(Do **not** clear it in `stopStream` at line 447 — it must persist after the stream ends, overwritten only by the next go-live. `session` is the freshly-returned `LiveSession`, so `session.broadcastId` needs no `!`.)

- [ ] **Step 4: Typecheck**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: no errors (the new required field is set in `INITIAL_STATE`, so no consumer breaks).

- [ ] **Step 5: Run the full test suite**

Run: `npm -w @axistream/app run test`
Expected: PASS (no existing test asserts the exact shape of `INITIAL_STATE` in a way the new field breaks; if one does, add `watchUrl: null` to its expected object).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/main/index.ts
git commit -m "feat: carry broadcast watchUrl in AppState, set at go-live"
```

---

### Task 3: "Copy link" button in StreamScreen

Render the copy button whenever `state.watchUrl` is set; copy via the clipboard and flash "Copied!" for ~1.5s.

**Files:**
- Modify: `packages/app/src/renderer/components/StreamScreen.tsx`

**Interfaces:**
- Consumes: `state.watchUrl` (Task 2).

- [ ] **Step 1: Import the icons**

In `packages/app/src/renderer/components/StreamScreen.tsx`, update the lucide-react import on line 2 to add `Link` and `Check`:

```ts
import { MonitorPlay, Radio, Square, RefreshCw, Loader2, Shield, Scan, Link, Check } from 'lucide-react'
```

- [ ] **Step 2: Add copy state and handler**

After line 15 (`const [editingMasks, setEditingMasks] = useState(false)`), add:

```ts
  const [copied, setCopied] = useState(false)
  const copyLink = () => {
    if (!state.watchUrl) return
    void navigator.clipboard.writeText(state.watchUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
```

- [ ] **Step 3: Render the button**

In `packages/app/src/renderer/components/StreamScreen.tsx`, inside the `hero-bottom` block, immediately after the closing `)}` of the go-live/end-stream conditional (after line 86, before the `</div>` that closes `hero-bottom` on line 87), add:

```tsx
        {state.watchUrl ? (
          <button className="btn ghost sm" onClick={copyLink} title="Copy the YouTube watch link">
            {copied ? <><Check size={14} /> Copied!</> : <><Link size={14} /> Copy link</>}
          </button>
        ) : null}
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Manual verification in the running app**

Run the app (`npm run dev` from repo root, or the project's usual dev command). Verify:
- Before any go-live: no "Copy link" button.
- After an OAuth go-live reaches LIVE: "Copy link" appears; clicking it flips to "Copied!" for ~1.5s and the clipboard holds `https://www.youtube.com/watch?v=<id>` (paste to confirm).
- After "End Stream": the button stays and still copies the same link.
- Starting a new go-live: the button now copies the new broadcast's link.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/components/StreamScreen.tsx
git commit -m "feat: add Copy link button to live UI"
```

---

## Self-Review Notes

- **Spec coverage:** watchUrl field + INITIAL_STATE (Task 2); set at OAuth go-live, not cleared on stop (Task 2 Step 3); helper shared with Discord (Task 1); button appears only when watchUrl set, "Copied!" flash, `navigator.clipboard` (Task 3). Key-mode guard: N/A — go-live is OAuth-only, noted in Global Constraints; no key branch exists to set `watchUrl: null`.
- **Out of scope confirmed absent:** no open-in-browser, no disk persistence, no main-process clipboard.
- **Type consistency:** `watchUrlFor(broadcastId: string): string` and `AppState.watchUrl: string | null` used identically across all tasks.
