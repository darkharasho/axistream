# Auto-Updater Polish (axibridge parity) — Design

**Date:** 2026-07-07
**Status:** Approved in concept ("adopt axibridge's polish"); this spec
pending user review before the plan.
**Scope:** Layer axibridge's updater UX onto our existing electron-updater
setup — retryable-error handling with friendly messages, a manual "Check for
updates" control with visible progress, and a "What's new" release-notes view
gated on `lastSeenVersion`. NOT a rewrite: `electron-updater` stays; the
GearLever AppImage workaround and hourly poll stay.

## What we already have (unchanged)

`updater.ts`: `electron-updater`, packaged-only, 4 s + hourly checks,
autoDownload + autoInstallOnAppQuit, `recreateMissingAppImage` (GearLever),
all lifecycle events → `updates:status`, `updates:check`/`updates:install`
IPC, the sidebar "Update ready" pill.

## What this adds

### 1. Retryable errors + friendly messages — `shared/autoupdate-errors.ts` (new, pure)

Ported from axibridge's `autoUpdateErrors.ts`:
```ts
export function extractAutoUpdateErrorMessage(err: unknown): string
export function isRetryableAutoUpdateError(err: unknown): boolean   // http2-refused, econnreset, etimedout, socket-hang-up, timeout, 502/503/504
export function formatAutoUpdateErrorMessage(err: unknown): string  // friendly copy per class, else the summarized first line
```
Wired into `updater.ts`'s `error` handler: on a retryable error, retry
`checkForUpdates()` once after 2 s (push a "temporary network issue,
retrying…" status); otherwise push `{ state: 'error', message:
formatAutoUpdateErrorMessage(err) }`. A retry counter resets on any
non-error lifecycle event (available/not-available/progress/downloaded).

### 2. Manual check + progress surface — Settings "Updates" section

- A new `Updates` section in `SettingsScreen` showing the current version
  (`app:version` — add this IPC back, it was cut) and a **Check for updates**
  button (`updates:check`, disabled while a check/download is in flight).
- The section subscribes to the existing `updates:status` and renders the
  state: idle / checking… / "vX.Y.Z available, downloading NN%" / "Ready —
  Restart to update" (button → `updates:install`) / the friendly error.
- The sidebar pill stays (quick affordance); this is the detailed view.
- In dev (`!app.isPackaged`) the button reports "up to date (dev build)".

### 3. What's new — release-notes view

- `versionNotes.ts` (new, app main, pure): `parseVersion`,
  `compareVersion`, and `selectReleaseNotes(releases, currentVersion,
  lastSeenVersion)` — filters GitHub-releases-API entries to those `>
  lastSeen` and `<= current`, newest first, returns concatenated markdown or
  null. (Ported from axibridge's versionUtils; the RELEASE_NOTES.md file
  fallback is dropped — our release workflow already sets
  `generate_release_notes: true`, so the GitHub API is the single source.)
- IPC `getWhatsNew(): Promise<{ version, notes: string | null }>` — main
  fetches `api.github.com/repos/darkharasho/axistream/releases?per_page=100`
  (best-effort, short timeout), runs `selectReleaseNotes` against the
  persisted `lastSeenVersion`, returns the range.
- `setLastSeenVersion(v)` IPC persists `lastSeenVersion` (new StreamSettings
  field, default '').
- UI: after an update installs (version changed since `lastSeenVersion`), the
  Updates section shows a "What's new in vX.Y.Z" panel with the notes and a
  "Got it" button that calls `setLastSeenVersion(currentVersion)`. Rendered
  as plain text/basic markdown (no HTML injection — the notes are GitHub
  markdown; render as preformatted text or a minimal safe renderer).

## Not ported (with reason)

- **Stale updater-cache cleanup** — axibridge needed it for its
  arcbridge→axibridge *rename*; AxiStream has never renamed, so there's no
  stale `~/.cache/<oldname>-updater` to purge. Skipped intentionally.
- **RELEASE_NOTES.md bundled fallback** — superseded by GitHub
  auto-generated notes (above).

## Error handling

Every added path best-effort: the GitHub notes fetch failing → what's-new
shows nothing (no error surfaced); retry exhaustion → the friendly error in
the Updates section; nothing blocks boot or the existing auto-flow. `app:
version` and `getWhatsNew` never throw out.

## Testing

- `autoupdate-errors`: each retryable class true / non-retryable false;
  `formatAutoUpdateErrorMessage` maps each class to its friendly string,
  falls back to the summarized message; `extract` handles Error/string/object.
- `versionNotes`: `parseVersion` (v-prefix, garbage → null),
  `compareVersion` ordering, `selectReleaseNotes` (range filter inclusive of
  current / exclusive of lastSeen, newest-first, empty → null).
- `updater.ts` retry: injected fake autoUpdater — a retryable error triggers
  exactly one re-check after the delay then gives up; a non-retryable pushes
  the formatted error; counter resets on a subsequent success (review-verified
  where the timer makes a unit test awkward).
- Settings Updates UI: version shown; Check button calls `updates:check`,
  disabled while in flight; status states render; Restart calls
  `updates:install`; what's-new panel shows notes + "Got it" →
  `setLastSeenVersion`.
- Manual smoke: with a real newer release, the Updates section walks
  checking → downloading% → Ready → Restart, and after relaunch shows
  "What's new".
