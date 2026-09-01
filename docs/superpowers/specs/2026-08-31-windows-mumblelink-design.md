# Windows MumbleLink — Design

## Problem

On Windows, a title template containing GW2 variables renders them empty:

```
2026-08-31 WvW Raid -  -  -
```

This is not a regression. `packages/capture/src/mumble-reader.ts` is
Linux/Proton-only by construction, and deliberately so:

- `findGw2Pid` scans `/proc/<pid>/comm` for `Gw2-64.exe` (`mumble-reader.ts:17`)
- `candidateRanges` locates the shared block by parsing `/proc/<pid>/maps` for
  Proton's deleted-tmpfile-backed `tmpmap-` `rw-s` mapping (`:24`)
- `readMem` reads `/proc/<pid>/mem`

`index.ts:81` already stubs the win32 arms to empty (`listPids: () => []`) so
`readIdentity` degrades to "GW2 not found" instead of throwing. That was the
right call at the time — it makes `resolveGw2()` return `undefined` and the
title render without the variables. Windows never had a reader to select.

## Goal

`{{character}}`, `{{class}}`, `{{map}}`, `{{race}}`, and `{{team}}` resolve on
Windows exactly as they do on Linux, from the same `MumbleIdentity` shape,
with the same never-blocks-go-live guarantee.

## Scope

**In:** a win32 identity source reading GW2's named `MumbleLink` file mapping;
platform selection of the reader; separator cleanup for a title whose variables
did not resolve.

**Out:** positional data (`fAvatarPosition`, camera vectors) — AxiStream only
consumes identity. Elevation mismatch recovery (see Risks). A UI surface for
"GW2 not detected"; the current silent degradation stands.

### Rejected alternatives

- **Generalize `MumbleDeps` to cover both platforms.** Its three methods
  (`readProc`, `listPids`, `readMem`) are a Linux process-memory vocabulary.
  Windows needs none of them: there is no pid to find and no address space to
  read, only a named mapping to open. Forcing both behind one interface means a
  Windows implementation that fakes pids to satisfy a signature it does not use.
- **A native addon (node-gyp / node-addon-api).** `npmRebuild: false` in
  `electron-builder.yml` and the whole packaging story assume prebuilds. koffi
  is already a production dependency and already loads `user32.dll` for the PTT
  poller — adding a compile step for four kernel32 calls buys nothing.
- **Reading the mapping through the GW2 API instead.** The API has no notion of
  "which character is logged in right now"; that is precisely what MumbleLink
  exists for. The API is already the enrichment layer here (`specName`,
  `mapName`, `teamColorName` all hit it) and stays that way.

## Architecture

### The seam

Extract the platform-independent part of `mumble-reader.ts` — `parseIdentityBuf`
and the `IDENTITY_OFFSET` / `IDENTITY_LEN` / `TICK_OFFSET` constants — and
export a pure

```ts
export function identityFromBlock(block: Buffer): MumbleIdentity | null
```

taking a buffer positioned at the start of `LinkedMem`. The Linux reader keeps
its `/proc` scan and calls it; the Windows reader maps the block and calls it.
Both platforms then share the one piece of logic that can actually be wrong
(UTF-16 JSON parsing), and it stays testable without either OS.

### `packages/capture/src/mumble-windows.ts`

```ts
export interface WindowsMumbleDeps {
  /** Maps the named shared block read-only and copies it out. null if absent. */
  mapBlock(name: string, size: number): Buffer | null
}
export function readIdentityWindows(d: WindowsMumbleDeps): MumbleIdentity | null
```

The real `mapBlock` is koffi over kernel32, loaded exactly like
`windows-keys.ts:29` — lazy, dynamic `createRequire`, wrapped in try/catch, so
tsc compiles clean and a non-win32 host never attempts the load:

- `OpenFileMappingW(FILE_MAP_READ = 0x0004, false, "MumbleLink")`
- `MapViewOfFile(h, FILE_MAP_READ, 0, 0, 0)`
- copy `LinkedMem` out, then `UnmapViewOfFile` + `CloseHandle` — unconditionally,
  in a `finally`. A leaked view here leaks on every go-live.

`LinkedMem` is 5460 bytes: `uiVersion`(4) `uiTick`(4) avatar pos/front/top(36)
`name`(512) camera pos/front/top(36) `identity`(512) `context_len`(4)
`context`(256) `description`(4096). Identity therefore starts at 592 — the same
`IDENTITY_OFFSET` the Linux reader already uses, which is a useful cross-check
that the existing offset is correct rather than empirically tuned to Proton.

**No liveness gate.** The Linux reader picks the ticking range because Proton
exposes several candidate `tmpmap-` regions and only one is real. Windows has
exactly one name, so there is nothing to disambiguate, and gating on `uiTick`
changing would introduce a sleep inside `resolveGw2()`'s 1500 ms race budget
(`index.ts:694`) to defend against a case that does not arise. The check that
matters is the one already in `parseIdentityBuf`: a parseable identity with a
non-empty `name`. A stale mapping left by another Mumble-aware app is zeroed and
fails that check.

### Selection

`resolveGw2` (`index.ts:101`) chooses by `process.platform`, following the
`select-backend.ts` idiom of a pure, unit-testable selector rather than an
inline ternary. Unlike hotkeys, this one **never throws** on unavailability:
PTT fails loud because a silently-dead hotkey mutes the user's mic, whereas a
missing identity costs a variable in a title. `undefined` is the correct answer
and the existing callers already handle it.

## Title separator cleanup

Independent of the backend, and worth doing regardless: `renderTitle`
(`TitleTemplate.ts:42`) substitutes `''` for an unresolved variable, so
`{{date}} WvW Raid - {{character}} - {{class}} - {{map}}` becomes
`2026-08-31 WvW Raid -  -  - `. Every user whose GW2 is closed at go-live gets
this, on both platforms.

Post-pass on the rendered string, applied only when at least one variable
resolved empty:

1. collapse runs of whitespace to one space
2. drop separator runs (`-`, `–`, `|`, `·`, `/`) that are adjacent to another
   separator or to a string boundary
3. trim

`WvW Raid -  -  -` → `WvW Raid`. `A - {{map}} - B` with an empty map → `A - B`.
A separator inside resolved text (`Willbender - WvW`) is untouched because it
has content on both sides. This is a pure function on the rendered string —
no template parsing, no per-variable bookkeeping — and tests as a table.

## Testing

- `identityFromBlock` — table tests over synthetic 5460-byte blocks: valid
  identity, zeroed block, truncated buffer, non-JSON, JSON without `name`.
  Covers both platforms' one fallible step. No OS dependency.
- `readIdentityWindows` — injected `mapBlock`: returns null when the mapping is
  absent, parses when present, returns null on a short buffer.
- Reader selection — pure selector, both platform arms.
- Separator cleanup — table tests, including the no-op case where everything
  resolved.
- koffi's four kernel32 calls stay untested by unit tests, as with the PTT
  poller. The Windows smoke harness (`--smoke`) can assert only that the reader
  returns null without throwing when GW2 is absent, which is the CI condition;
  a real identity read requires GW2 running and stays a manual smoke.

## Risks

- **Integrity level.** `OpenFileMappingW` on a session-local name fails across
  an integrity boundary. If AxiStream runs elevated and GW2 does not (or the
  reverse), the mapping is invisible and the reader returns null — identical to
  "GW2 not running", with no way to tell them apart from inside the process.
  Acceptable: the degradation is already the designed one. Worth a line in the
  docs rather than a code path.
- **koffi absent.** Same failure shape as PTT's, handled the same way — lazy
  load, try/catch, null reader. Unlike PTT this must not throw.
- **GW2 must have MumbleLink enabled and the player must be in a map.** The
  character-select screen writes no identity. Same on Linux today.
