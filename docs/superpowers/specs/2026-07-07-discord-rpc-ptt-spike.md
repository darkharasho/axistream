# Discord RPC Push-to-Talk Control — Spike Findings

**Date:** 2026-07-07 (overnight)
**Status:** Investigated; implementation proposal ready, needs two user
inputs (a Discord application + Discord running for the live probe).

## The ask

"If possible to either control Discord PTT or not interfere, that would be
HUGE." Today's shipped design already achieves **non-interference**: AxiStream
gates the mic at the PipeWire source and Discord (in Voice Activity mode)
follows. This spike investigates the stronger option: **controlling Discord's
own mute natively**, so Discord could stay in whatever mode it likes.

## Findings

1. **Discord exposes a local RPC socket** — `$XDG_RUNTIME_DIR/discord-ipc-0`
   (verified present on this machine; a live handshake probe failed only
   because Discord wasn't running at the time — the file was stale. Re-probe
   with Discord open).
2. **The RPC API can set voice settings**: `SET_VOICE_SETTINGS` with
   `{ mute: boolean }` — the exact primitive PTT needs. Frame protocol is
   trivial (8-byte LE header op+len, JSON payloads; op0 handshake with a
   `client_id`, then AUTHORIZE/AUTHENTICATE, then commands).
3. **The whitelist caveat that kills most apps doesn't kill ours**: RPC
   scopes (`rpc`, `rpc.voice.write`) are gated behind Discord's app-approval
   process **except for the application owner's own account**. Tools like
   MuteDeck rely on this. For a personal tool gated to one user — exactly
   this project's framing — the user creates their own Discord application
   (discord.com/developers → New Application → copy client id) and RPC works
   for their account with no approval.
4. **First-use consent**: the first AUTHORIZE pops an in-Discord consent
   modal (once). This must not fire silently at boot — it should happen from
   an explicit "Connect Discord" button.

## Proposed design (not yet implemented)

- `DiscordRpcClient` (app main, injected socket factory — same pattern as
  every controller): connect → handshake(client_id) → AUTHORIZE
  (`rpc`,`rpc.voice.write`) → token exchange → AUTHENTICATE; persist the
  OAuth token (safeStorage) so consent is once-ever. Best-effort throughout.
- `PttController` gains an optional `discord` dep: on press/release edges,
  *in addition to* the source mute, call `SET_VOICE_SETTINGS { mute: false/true }`.
  With Discord-mute control active the user may keep Discord in ANY mode.
- Settings: `discordRpcClientId` (string, from their app), a "Connect
  Discord" button in Audio settings with status; degrade gracefully when
  Discord is closed (source gate still covers the stream; reconnect with
  backoff).
- Failure isolation identical to the source gate: nothing may delay the edge
  handling (fire-and-forget sends on an already-open socket).

## What's needed from the user

1. Create a Discord application (their account) → client id into settings.
2. Have Discord running; approve the one-time consent modal.
3. A short live session to validate `SET_VOICE_SETTINGS` behaves (the one
   thing this spike could not verify with Discord closed).

## Recommendation

Worth building — it's ~a PttController-sized feature reusing established
patterns, and it upgrades "don't interfere" to "fully controlled". Blocked
only on the two user inputs above; propose doing the live probe together,
then the standard spec → plan → SDD flow.
