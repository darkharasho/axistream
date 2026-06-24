# YouTube OAuth Go-Live + Title Templates — Design

**Date:** 2026-06-24
**Status:** Approved (design); pending implementation plan
**Branch context:** `feat/stream-ux-and-golive`

## Problem

The current go-live path pushes RTMPS to YouTube using a user-pasted persistent
stream key (`StreamController.goLive(key)` → `SetStreamServiceSettings` +
`StartStream`). Two issues:

1. **It doesn't reliably go live.** Bytes reach YouTube, but no broadcast in
   `live` state is bound to the stream, so nothing appears on the channel. A
   pasted persistent key only surfaces if the channel happens to have auto-start
   configured. (Observed failure mode: connects and pushes, but YouTube shows
   nothing.)
2. **The stream key is a poor UX.** Copy-pasting a key from YouTube Studio is a
   tough sell for an app whose promise is "live in about three clicks."

OAuth + the YouTube Live Streaming API fixes (1) deterministically (create →
bind → wait for ingestion → transition to `live`) and removes the manual paste
for (2).

## Non-goals

- Replacing the RTMPS push pipeline. OAuth still streams via a stream key under
  the hood; we keep the existing push path and the auth-free `ensureCleanProfile`
  fix intact.
- GW2 game-state title variables (Mumble Link / GW2 API). Documented as v2 below.
- OAuth for non-YouTube destinations.

## Architecture

The existing push pipeline is preserved. We add an **OAuth go-live mode** in
front of it and keep **manual-key mode** as a fallback.

New units, each with a single responsibility and an injectable interface:

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `TokenStore` | Encrypted OAuth token storage (mirror of `KeyStore`, `safeStorage`, file `yt-tokens.bin`) | Electron `safeStorage` |
| `YouTubeAuth` | OAuth 2.0 PKCE loopback flow; persist + refresh tokens | `TokenStore`, system browser, loopback HTTP listener |
| `YouTubeLive` | YouTube Live Streaming API wrapper: `createBroadcast`, `getOrCreateStream`, `bind`, `transition`, `complete`, stream-health poll | access token from `YouTubeAuth` |
| `TitleTemplate` | Pure resolver: template + injected clock/counter → title string | injected clock + counter (no I/O) |
| `SettingsStore` | Title template, date format, default privacy, persisted `{{n}}` counter | userData persistence |
| `StreamController` | Refactored to run OAuth mode or manual-key mode | `YouTubeLive` (OAuth), obs-websocket client |

### Why keep OBS auth-free

Per the prior go-live fix, an OBS profile carrying YouTube auth routes
`StartStream` through OBS's own broadcast flow, which silently no-ops headless.
We do all broadcast management at the **app** layer (`YouTubeLive`) and keep OBS
on the dedicated auth-free `AxiStream` profile (`ensureCleanProfile`). This
preserves the existing fix — OBS only ever does a plain RTMP(S) push.

## Go-live data flow (OAuth mode)

1. User clicks **Go Live**.
2. Resolve title from the template. **If the template is empty, show a title
   prompt modal.** Resolve privacy from settings (default Public).
3. `YouTubeLive.createBroadcast(title, privacy, start=now)` → `broadcastId`.
4. `getOrCreateStream()` → reusable `liveStream` → ingestion `{server, key}`.
5. `bind(broadcastId, streamId)`.
6. Hand `{server, key}` to the existing push path:
   `SetStreamServiceSettings({ streamServiceType: 'rtmp_custom', server, key })`
   then `StartStream`. Profile remains auth-free.
7. Poll until **both**: OBS `GetStreamStatus.outputActive` (bytes flowing) **and**
   YouTube stream health = `active`.
8. `transition(broadcastId, 'live')`.
9. Increment the `{{n}}` counter on success.
10. **Stop** → `StopStream` + `transition(broadcastId, 'complete')`.

### Manual-key mode (fallback)

Unchanged from today: `KeyStore` key → `SetStreamServiceSettings` + `StartStream`
→ poll `GetStreamStatus`. Selected when the user hasn't connected a YouTube
account, or chooses to paste a key. Kept available so the app ships before
Google OAuth verification completes (see Landmines).

## Template engine (v1)

Variables resolved at go-live:

| Variable | Meaning | Source |
|----------|---------|--------|
| `{{date}}` | Today's date, configurable format | injected clock |
| `{{time}}` | Current clock time | injected clock |
| `{{day}}` | Weekday name (e.g. "Wednesday") | injected clock |
| `{{week}}` | ISO week number | injected clock |
| `{{n}}` | Auto-incrementing session counter, persisted | `SettingsStore` |

- **Date format is a configurable format string** in settings (default ISO
  `2026-06-24`; user can set e.g. `M/D/YY` for `6/24/26`).
- **Unknown variables render as empty string** (engine never throws on a typo).
- Lookups go through a **resolver map** (`name -> () => string`) so v2 GW2 vars
  register without changing the engine.
- The settings UI shows a **live preview** of the resolved title as the user types.

Example: `EWW Raid - {{date}}` → `EWW Raid - 2026-06-24`.

## Settings

- **YouTube account:** Connect / Disconnect (OAuth). Shows connected channel
  name when authed.
- **Title template:** text field + variable help + live preview. Empty → prompt
  at go-live.
- **Date format:** format string, default ISO.
- **Default privacy:** Public (default) / Unlisted / Private.
- **Stream key (fallback):** existing paste field, retained.

## Error handling

- **OAuth:** browser closed / consent denied / refresh fails → mark disconnected,
  prompt re-auth. Never crash go-live; surface a clear message.
- **Ingestion never active:** reuse the existing ~15s `failStart` timeout, and
  additionally **clean up the orphan broadcast** (`transition` to complete or
  delete) so the channel doesn't accumulate dead `ready` events.
- **API quota / network errors:** surfaced via the existing `ERROR` phase with a
  human-readable message.
- **OBS calls:** keep the `callReady` retry (25 × 800ms). **API calls:** their own
  bounded backoff (do not reuse OBS timings).

## Testing

Each unit tested in isolation with injected dependencies:

- **`TitleTemplate`** (pure, fake clock + counter): every variable, configurable
  date format, empty template, unknown variable → empty, counter increment.
- **`YouTubeAuth`:** mock loopback listener + token exchange; token refresh on
  expiry; refresh-failure → disconnected.
- **`YouTubeLive`:** mock API client; create/bind/transition call order; error
  paths; orphan-broadcast cleanup.
- **`StreamController` OAuth mode:** mock `YouTubeLive` + obs client; happy path;
  ingestion-timeout triggers cleanup; stop transitions broadcast to complete.
- **Existing manual-key tests** stay green (no behavior change in that mode).

## v2 roadmap (documented, not built)

GW2 title variables plug into `TitleTemplate`'s resolver map:

| Variable | Source | Notes |
|----------|--------|-------|
| `{{character}}` | Mumble Link identity | local, no auth |
| `{{class}}` / `{{spec}}` | Mumble Link identity | local, no auth |
| `{{map}}` | Mumble Link map id + `/v2/maps/:id` for name | unauthenticated GW2 API |
| `{{guild}}` | Mumble Link guild id + `/v2/guild/:id` for tag/name | unauthenticated GW2 API |
| `{{gamemode}}` | `/v2/maps/:id` type (WvW/PvP/PvE); Raid/Fractal/Strike needs a map-id table | unauthenticated GW2 API |
| `{{wvw_score}}` | Mumble Link world + `/v2/wvw/matches` | unauthenticated GW2 API |
| `{{boss}}` | **No official source** — requires arcdps combat-log parsing | flagged needs-arcdps / maybe-never |

Dream template enabled in v2: `{{gamemode}} - {{date}} - {{guild}} - {{class}}`.

## Landmines (call out in implementation)

1. **Google OAuth verification.** YouTube scopes (`youtube` / `youtube.force-ssl`)
   are sensitive; a published app needs Google's OAuth app verification, which
   takes weeks and, until approved, shows an "unverified app" warning and caps
   at ~100 users. **The retained manual stream-key path is the unblock** for
   shipping before verification completes.
2. **YouTube Live API quota.** Each broadcast create consumes API quota. Fine for
   normal personal use; note it so a future "auto-restart" loop doesn't burn the
   daily quota.
