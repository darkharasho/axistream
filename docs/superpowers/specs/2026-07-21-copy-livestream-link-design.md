# Copy Livestream Link Button — Design

**Date:** 2026-07-21
**Status:** Approved, ready for implementation plan

## Problem

After going live on YouTube, a streamer needs to share the watch link (to Discord, chat, etc.). The app already knows the broadcast's watch URL — it builds one inline for the Discord announce — but never surfaces it in the UI. There is no way to copy the link from AxiStream itself.

## Goal

Add a "Copy link" button to the live UI that copies the current broadcast's YouTube watch URL to the clipboard.

## Behavior

- After an **OAuth go-live**, the app knows the broadcast/video ID (`session.broadcastId`) and can build the watch URL `https://www.youtube.com/watch?v=<broadcastId>`. A **"Copy link"** button appears in the live UI.
- The button (and the stored URL) **persists after the stream ends** — the VOD lives at the same URL — so the link stays copyable. It is:
  - **overwritten** when a new OAuth go-live starts, and
  - **reset to `null`** when a pasted-key (non-OAuth) go-live starts, so a stale prior link never lingers over a key stream.
  - It is in-memory state only, so it is naturally gone after the app closes.
- The button **never appears for pasted-key streams** — there is no broadcast, so no link exists (matches the app's "no fake affordances" ethos).
- Clicking copies the URL via the clipboard and swaps the button label to **"Copied!"** for ~1.5s, then reverts.

## Architecture / Data Flow

1. **Shared state** — `packages/app/src/shared/state.ts`
   - Add `watchUrl: string | null` to the `AppState` interface.
   - Initialize `watchUrl: null` in `INITIAL_STATE`.

2. **URL helper** — a small pure function `watchUrlFor(broadcastId: string): string` returning `https://www.youtube.com/watch?v=${broadcastId}`. Placed where both the go-live handler and the Discord announce can share it (e.g. alongside `YouTubeLive.ts` or a small util module). This replaces the inline template string currently at `main/index.ts:433`.

3. **Main process go-live** — `packages/app/src/main/index.ts` (`goLive` handler, ~lines 388–446)
   - **OAuth path:** right after `startSession` succeeds, compute `const watchUrl = watchUrlFor(session.broadcastId)` and include `watchUrl` in the go-live `setState({ ... })` (near line 409). Reuse the same `watchUrl` for the Discord `announce({ ..., watchUrl })` call (replacing the inline template at line 433).
   - **Key-mode path:** the go-live `setState` sets `watchUrl: null`.
   - **Do NOT** clear `watchUrl` on `stopStream` (~line 447) — it persists until the next go-live.

4. **Transport** — no new IPC channel. `watchUrl` rides the existing `CH.evtState` (`'axi:evt:state'`) state push to the renderer.

5. **Renderer** — `packages/app/src/renderer/components/StreamScreen.tsx`
   - Read `state.watchUrl`. When non-null, render a **"Copy link"** button in the button block near End Stream / Go Live (~lines 72–86).
   - On click: `navigator.clipboard.writeText(state.watchUrl)` (first clipboard use in the app; renderer-side keeps it simple, no new preload/IPC surface). Use local `useState` + `setTimeout` to flip the label to "Copied!" for ~1.5s and revert.

## Testing

- **Unit:** `watchUrlFor(broadcastId)` builds the correct URL. Assert the go-live handler sets `watchUrl` from `session.broadcastId` on the OAuth path and `watchUrl: null` on the key-mode path (to whatever extent the handler is unit-testable; otherwise cover the helper and the state shape).
- **Manual:** verify the button appears only after an OAuth go-live, copies the correct link, shows "Copied!", persists after End Stream, and is absent/replaced correctly for a subsequent key-mode go-live.

## Out of Scope (YAGNI)

- No "Open in browser" button.
- No copy affordance in pasted-key mode.
- No persisting the URL to disk across app restarts.
- No copy from the main process / Electron `clipboard` module — renderer `navigator.clipboard` is sufficient.
