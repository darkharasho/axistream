# Diagnostics Export — Design

**Date:** 2026-08-24
**Status:** Approved, ready for implementation plan
**Parent:** [1.0 Release Master Plan](./2026-08-24-v1.0-release-design.md) — sub-project 2 of 7

## Problem

When AxiStream misbehaves on a user's machine, neither the user nor we can collect
evidence. The mic-silent incident went root-cause-unpinned for exactly this reason, and the
Windows OBS-NotReady failure has been open since v0.1.12 with no OBS output to explain it.

The gap is more basic than "we have no export button". **There is no app log.** The only
file the app writes is `logs/updater.log`. All thirty-five `console.*` calls in the main
process go to stdout, which a packaged Electron build discards. Collecting the app log
therefore means building it first.

Two related losses:

- The Linux launchers pipe OBS's stdout and stderr and then forward them to
  `process.stdout` with an `[obs]` prefix (`obs-launcher.ts:45-46`,
  `headless-cage-launcher.ts:28-29`). The output is captured and immediately thrown away.
- `windows-obs-launcher.ts:157` spawns with `stdio: 'ignore'`, so on Windows it is never
  captured at all. This is the direct cause of the open OBS-NotReady bug having no logs.

## Goal

Give a user one button that produces a single file they can hand us, containing enough
evidence to diagnose a capture, encode, audio, or boot failure — without leaking their
stream key, OAuth tokens, or Discord webhook.

## Non-goals

No telemetry, no automatic upload, no crash reporter. The user produces a file and chooses
what to do with it. Crash reporting remains on the release tail, deliberately separate.

## Decisions

Four decisions were settled during brainstorming and constrain everything below.

**The app log is a rolling file on disk, not an in-memory ring buffer.** A buffer dies with
the process, losing exactly the log that explains a crash — and "the app died, then I
relaunched it" is the primary scenario diagnostics exist for.

**Redaction uses two mechanisms matched to two data shapes.** Free-text log lines get a
regex denylist at write time, because free text offers no other option and because the log
file will be shared directly — a user emails `axistream.log`, not always a bundle.
Structured dumps get a field *allowlist*, because their shape is known. The allowlist is
the load-bearing half: it means a field added to `AppState` by a later sub-project does not
silently begin shipping in bundles.

**Delivery is a fixed path plus a toast carrying it**, not a save dialog and not
`shell.showItemInFolder`. `showItemInFolder` is unreliable across Linux desktop
environments, and its failure mode is the dangerous one — silently doing nothing leaves the
user believing the export failed when the zip is written and fine. A toast degrades to
text, which always works. This is also the toast channel's first real consumer.

**OBS log collection extends to the launchers.** Collecting only OBS's own log files would
miss the Windows failure entirely, because OBS's self-logging begins after the point at
which that failure occurs.

## Architecture

### 1. Log sink

New `packages/app/src/main/log.ts`.

```ts
export interface LogSink { write(level: LogLevel, message: string): void; readonly path: string }
export function createLogSink(opts: { dir: string; maxBytes?: number; scrub?: (s: string) => string }): LogSink
export function installLogSink(sink: LogSink): void
```

Writes `logs/axistream.log`, rotating to a single `axistream.log.1` when the file exceeds
**2 MB**. One backup only, so the on-disk footprint is bounded at 4 MB and never requires a
cleanup job.

Line format: `2026-08-24T18:03:12.441Z WARN message`.

`installLogSink` patches `console.log`, `console.warn`, and `console.error` to tee: the
original console (so `npm run dev` is unchanged) plus the sink. It is called early in
`main/index.ts`, before OBS provisioning, so boot failures fall inside the window.

Every write is wrapped and swallows its own failure. A full disk must not take the app
down — the same discipline the OBS layer already follows.

### 2. Redaction

New `packages/app/src/main/redact.ts`.

`scrubLine(s: string): string` — write-time denylist covering:

| Pattern | Replacement |
|---|---|
| `discord.com`/`discordapp.com` webhook URLs | `https://discord.com/api/webhooks/<redacted>` |
| `Bearer <token>` | `Bearer <redacted>` |
| `key=` / `stream_key=` query parameters | `key=<redacted>` |
| YouTube stream-key shape (`xxxx-xxxx-xxxx-xxxx-xxxx`) | `<redacted-stream-key>` |
| `os.homedir()` | `~` |

The home-directory rule is a literal string replacement, not a regex, so a path containing
regex metacharacters cannot defeat it.

`pickState(state: AppState): Record<string, unknown>` — an explicit allowlist for the
structured dump. Includes `phase`, `encoder`, `videoBitrateKbps`, `capture`, `stats`,
`audio` (device *names* and enablement), `masks` (count and geometry only),
`gameAudioPlugin`, `blurPlugin`, `maskStyle`, `ptt` in full (it holds no secrets),
`windowFitted`, `masksVisible`, `youtube.connected`, `settings.titleTemplate`,
`settings.dateFormat`, `settings.privacy`. Excludes `settings.discordWebhookUrl`,
`settings.discordMessage`, `youtube.channel`, and `watchUrl`.

### 3. Collector

New `packages/app/src/main/diagnostics.ts`.

```ts
export interface DiagnosticsDeps {
  outDir: string
  logDir: string
  obsConfigRoot: string | null
  client: () => OBSWebSocket | null
  state: () => AppState
  versions: { app: string; electron: string; node: string; os: string }
}
export function collectDiagnostics(d: DiagnosticsDeps): Promise<{ ok: boolean; path?: string; error?: string }>
```

Bundle contents:

| Entry | Source |
|---|---|
| `report.json` | app/electron/node versions, platform, arch, OS release, timestamp, `pickState(state)` |
| `axistream.log`, `axistream.log.1` | the rolling log |
| `updater.log` | the log that already exists |
| `obs/<name>.txt` | the three most recent files in `<configRoot>/obs-studio/logs` |
| `obs/scenes.json` | `GetSceneList` + `GetSceneItemList` per scene, scrubbed |
| `obs/inputs.json` | `GetInputList` + `GetInputSettings` per input, scrubbed |

Excluded by construction: OBS's `service.json`, which is where the stream key lives, and
the token store.

**Each entry is independently best-effort.** A source that fails writes
`<name>.error.txt` containing the reason rather than aborting the zip. This is the most
important property in the design: diagnostics are collected precisely when things are
broken, so a collector that dies because OBS is unreachable is useless in exactly the
situation it exists for.

Output path: `<userData>/diagnostics/axistream-diagnostics-<YYYYMMDD-HHMMSS>.zip`. The
directory is pruned to the **five** most recent bundles after each export, so repeated
exports during a debugging session cannot grow without bound.

Zipping uses **`archiver`**, promoted from an electron-builder transitive to an explicit
`packages/app` dependency. It is already resolved in the lockfile, so this adds no new
supply-chain surface and no fresh resolution — which matters given the npm#4828 lockfile
pinning already worked around in CI. Per project convention, a new main-process dependency
requires running the build gate, not just the test suite.

### 4. Launcher output

`OwnedObsRuntime` gains `readonly configRoot: string`. Both implementations already compute
this path — Linux inline at `linux-owned-obs-runtime.ts:106`, Windows at
`windows-owned-obs-runtime.ts:186` — and both are derivable at construction, so this is a
DRY refactor rather than a new concept:

- Linux: `join(homedir(), '.var', 'app', manifest.appId, 'config')`
- Windows: `join(installRoot, manifest.obsVersion, 'config')`

`obs-launcher.ts` and `headless-cage-launcher.ts` replace `process.stdout.write` with
`console.log('[obs] …')`. That alone routes the already-captured Linux output into the
sink, and it keeps `@axistream/capture` decoupled — it depends on `console`, not on the
app's sink.

`windows-obs-launcher.ts` moves from `stdio: 'ignore'` to `['ignore', 'pipe', 'pipe']` with
drain handlers attached at spawn. **The handlers must be attached immediately**, or a
chatty OBS can block on a full pipe. `smoke-windows` is the gate that catches this.

### 5. IPC and UI

One new channel, `CH.exportDiagnostics = 'axi:exportDiagnostics'`, returning
`{ ok: boolean; path?: string; error?: string }` and taking **no arguments** — main gathers
everything itself, so the call still works from a renderer whose tree has partly collapsed.

Two entry points:

- New `DiagnosticsSettings` panel in `SettingsScreen`, stating plainly what the bundle
  includes and what it excludes, with an "Export diagnostics" button and a busy state.
- A third button in the `ErrorBoundary` fallback, beside "Copy error details". The crash
  screen is when diagnostics matter most.

Both report through the toast channel: success carries the path in `detail`, failure
carries the reason.

## Data flow

```
console.warn(...)  →  installLogSink tee  →  scrubLine  →  logs/axistream.log (rotating)
OBS child stdout   →  console.log('[obs] …')  ─┘

click Export  →  CH.exportDiagnostics  →  collectDiagnostics
              →  gather each source (best-effort, per-entry error files)
              →  archiver → diagnostics/axistream-diagnostics-<ts>.zip
              →  prune to 5  →  { ok, path }  →  toast(success, detail = path)
```

## Testing

- **`log.test.ts`** — writes a line in the expected format; rotates at `maxBytes` into
  `.log.1` and keeps exactly one backup; a write failure does not throw. Rotation is tested
  against a **real temp directory**, not a mocked `fs` — rotation bugs only appear against a
  real filesystem.
- **`redact.test.ts`** — each denylist pattern is replaced; a home path containing regex
  metacharacters is still replaced; `pickState` omits `discordWebhookUrl`, `discordMessage`,
  `youtube.channel`, and `watchUrl`, and a newly added `AppState` field does not appear.
- **`diagnostics.test.ts`** — produces a zip at the expected path; a throwing OBS client
  still yields a zip, containing `obs/scenes.error.txt`; a missing config root omits the
  OBS log entries without failing; pruning keeps the five most recent bundles.
- **`ipc-contract.test.ts`** — extend to cover `exportDiagnostics`.
- **Launcher tests** — the Windows launcher spawns with piped stdio and attaches data
  handlers; the Linux launchers route through `console.log`.

Gates before merge, per project convention: `npm -w @axistream/app run test`,
`npm -w @axistream/capture run test`,
`cd packages/app && npx tsc --noEmit -p tsconfig.json`, and — because of the new
dependency — `npm run build`.

## Out of scope (YAGNI)

- Telemetry, automatic upload, or a crash reporter.
- A log-level filter or verbosity setting.
- Viewing logs in-app.
- Collecting system-wide logs (`journalctl`, Event Viewer) or `pactl` output.
- Redacting OBS's own log files beyond `scrubLine`.
