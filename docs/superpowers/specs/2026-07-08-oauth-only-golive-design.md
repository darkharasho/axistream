# OAuth-only go-live with real live confirmation

**Date:** 2026-07-08
**Status:** Approved design

## Problem

Two truthfulness gaps in go-live, surfaced while debugging a "packaged app says
streaming but my channel shows no stream" report:

1. **Silent key-mode degradation.** When the app isn't OAuth-connected,
   `goLive()` falls back to pushing a raw stream key (`index.ts:392–398`) with no
   broadcast lifecycle. OBS streams happily and the UI reports **LIVE**, but no
   broadcast is created on the channel and the app cannot verify one exists.
2. **Discarded live confirmation.** Even on the OAuth path, `confirmLive()`'s
   result is thrown away (`index.ts:417`). The UI flips to LIVE purely on OBS
   `outputActive`, regardless of whether YouTube actually transitioned the
   broadcast to `live`.

Now that AxiStream's OAuth app is Google-verified (durable refresh tokens), the
manual-key path has no remaining value: it is the *only* unverifiable go-live
path, and it exists solely as a fallback for an OAuth flow that now works.

## Decision

Remove manual stream-key mode entirely and make the OAuth path the only way to
go live, with the UI reporting LIVE only once YouTube confirms the broadcast is
actually live. The app becomes truthful by construction rather than by warning.

## Scope

### Removed
- `KeyStore.ts`, `key.bin` persistence
- `saveKey` / `forgetKey` — IPC handlers (`ipc.ts`), preload bindings, `AxiApi`
  methods, and `CH` channels
- `KeyInput.tsx`
- `keyMasked` from `AppState` / `INITIAL_STATE`
- `YT_RTMPS` constant and the `if (!auth.isConnected())` key branch in `goLive()`
- `NEEDS_KEY` phase
- Key-mode tests

### Trade-off accepted
If OAuth is ever unavailable (Google outage, revoked grant, Live API quota),
there is no in-app fallback to go live. Judged acceptable: it's the user's own
channel, quota is thousands of ops/day for a single user, and OBS can be driven
directly in a true emergency.

## Design

### 1. Readiness gate: key-based → OAuth-based

Today `goReadyPhase = () => keyStore.masked() ? 'READY' : 'NEEDS_KEY'`
(`index.ts:351`) — the app only reaches READY when a key is saved, even in OAuth
mode. Flip it:

```
goReadyPhase = () => auth.isConnected() ? 'READY' : 'NEEDS_YOUTUBE'
```

- `NEEDS_KEY` → **`NEEDS_YOUTUBE`** in the `StreamPhase` union.
- `connectYouTube` handler (exists, `index.ts:456`): on success move
  `NEEDS_YOUTUBE → READY`.
- `disconnectYouTube`: move `READY → NEEDS_YOUTUBE`.
- `smoke.ts:25` treats `NEEDS_KEY` as a terminal success state → update to
  `NEEDS_YOUTUBE` so the Windows smoke CI job stays green.
- If `goLive()` is somehow invoked while not connected, it sets
  `NEEDS_YOUTUBE` and returns (defensive; the button is gated in the UI).

### 2. Live confirmation (core)

New phase **`STARTING_ON_YOUTUBE`** ("Starting on YouTube…"), shown after OBS
ingest is active but before YouTube confirms the broadcast is live.

The existing `onIngestActive` hook in `index.ts` becomes:

1. `setState({ phase: 'STARTING_ON_YOUTUBE' })`.
2. Poll `live.confirmLive(broadcastId)` every **~3s**, up to a **~45s** deadline.
3. **Confirmed within deadline** → return normally → `StreamController` emits
   `LIVE` (now truthful). `liveUnconfirmed` stays `false`.
4. **Deadline reached, still not live** → return normally (do **not** throw —
   throwing routes through `failStart` and tears the stream down). Set
   `liveUnconfirmed: true`. Phase still becomes `LIVE`; the UI shows a warning
   sub-line: *"YouTube hasn't started your broadcast yet — check YouTube Studio."*
   A cheap background poll continues and **clears `liveUnconfirmed`** if YouTube
   starts the broadcast late. The background poll is torn down on stop.

Timing constants (`confirmPollMs = 3000`, `confirmDeadlineMs = 45000`) are
injectable so tests can use small values.

### 3. StreamController change (keeps it YouTube-agnostic)

`setInterval` does not await the async tick handler, so a later tick currently
emits `onPhase('LIVE')` (line 73) while `onIngestActive` is still pending. Gate
LIVE emission on `this.live` (which is already only set to `true` *after*
`onIngestActive` resolves):

```
if (st.outputActive && !becameLive) {
  becameLive = true
  try { await this.hooks.onIngestActive?.() } catch { await this.failStart(c, target, false); return }
  this.live = true
}
if (this.live) this.d.onPhase(st.outputReconnecting ? 'RECONNECTING' : 'LIVE')
this.d.onStats(this.mapStats(st, pollMs))
```

Effect: during the confirmation window `becameLive` is true but `this.live` is
false, so no `LIVE` phase is emitted (index.ts owns `STARTING_ON_YOUTUBE`);
stats still flow. This is the only change to `StreamController`.

### 4. State additions

- `StreamPhase`: replace `NEEDS_KEY` with `NEEDS_YOUTUBE`; add
  `STARTING_ON_YOUTUBE`.
- `AppState`: remove `keyMasked`; add `liveUnconfirmed: boolean` (default
  `false`; reset to `false` on stop / return to READY).

### 5. UI

- `StreamScreen`:
  - `NEEDS_KEY` → `KeyInput` block becomes `NEEDS_YOUTUBE` → **"Connect YouTube
    to go live"** prompt wired to `connectYouTube`.
  - New `STARTING_ON_YOUTUBE` spinner/label state.
  - LIVE chip renders the warning sub-line when `liveUnconfirmed` is true.
  - Remove the `keyMasked` pill / Forget button.
- `SettingsScreen`: remove the stream-key row (`KeyInput` + key pill); the
  existing `YouTubeSettings` connect/disconnect UI stays.

## Testing (TDD)

- **StreamController:** LIVE is not emitted while `onIngestActive` is pending;
  is emitted after it resolves; stats flow during the wait.
- **Confirmation:** `confirmLive` true within deadline → ends `LIVE`,
  `liveUnconfirmed` false. Never true → ends `LIVE`, `liveUnconfirmed` true.
  Late-true → background poll clears `liveUnconfirmed`.
- **Gate:** not connected → `NEEDS_YOUTUBE`; `connectYouTube` success → `READY`;
  `disconnectYouTube` → `NEEDS_YOUTUBE`.
- Delete/replace key-mode tests; update `smoke.ts` expectations.

## Verification

- `npm -w @axistream/app run test` green
- `cd packages/app && npx tsc --noEmit -p tsconfig.json` clean
- Manual smoke: fresh (no token) start lands on `NEEDS_YOUTUBE`; connect → go
  live → observe `STARTING_ON_YOUTUBE` then truthful `LIVE`; confirm the
  broadcast appears on the channel.
