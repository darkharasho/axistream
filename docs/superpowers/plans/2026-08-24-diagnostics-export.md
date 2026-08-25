# Diagnostics Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the user one button that produces a single redacted zip containing enough evidence to diagnose a capture, encode, audio, or boot failure.

**Architecture:** A rolling on-disk log sink tees `console.*` in the main process through a redaction pass. A collector gathers that log, OBS's own logs, and a field-allowlisted state dump into a zip via `archiver`. One argument-free IPC channel drives it, surfaced in Settings and in the crash boundary, reporting through the toast channel from sub-project 1.

**Tech Stack:** Electron 31 main process, Node `fs`, `archiver`, obs-websocket via `sidecar.client()`, React 18 renderer, Vitest 2.

**Spec:** [`docs/superpowers/specs/2026-08-24-diagnostics-export-design.md`](../specs/2026-08-24-diagnostics-export-design.md)

## Global Constraints

- Code style: 2-space indent, **no semicolons**, single quotes, named exports, `.js` extensions on relative imports (ESM/NodeNext). No linter is configured — match surrounding code by eye.
- OBS calls stay best-effort: `console.warn`, never throw out. Nothing here may block boot or block go-live.
- Log writes must swallow their own failures. A full disk must not take the app down.
- Every diagnostics source is independently best-effort: a failing source writes `<name>.error.txt` into the bundle instead of aborting the zip.
- Rotation threshold: **2 MB**, exactly **one** backup (`axistream.log.1`).
- Bundle retention: the **five** most recent zips in `<userData>/diagnostics/`.
- Redaction is two mechanisms: regex denylist (`scrubLine`) for free text, field **allowlist** (`pickState`) for structured dumps. Never widen `pickState` to a denylist.
- `archiver` is a new **main-process** dependency, so `npm run build` is a required gate, not just the test suite.
- Tests: `npm -w @axistream/app run test`, `npm -w @axistream/capture run test`. Vitest fork pool is already capped at `maxForks: 2` — respect it, do not raise it.
- Typecheck gate: `cd packages/app && npx tsc --noEmit -p tsconfig.json`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/app/src/main/redact.ts` | `scrubLine` denylist + `pickState` allowlist. Pure, no I/O. |
| `packages/app/src/main/log.ts` | Rolling file sink + `console` tee. Owns rotation. |
| `packages/app/src/main/diagnostics.ts` | Gathers sources, builds the zip, prunes old bundles. |
| `packages/app/src/renderer/components/DiagnosticsSettings.tsx` | Settings panel and its busy state. |
| `packages/capture/src/owned-obs-runtime.ts` | Gains `configRoot` on the interface. |
| `packages/capture/src/{linux,windows}-owned-obs-runtime.ts` | Compute `configRoot` once in the constructor. |
| `packages/capture/src/{obs,headless-cage,windows-obs}-launcher.ts` | Route OBS child output through `console`. |

`redact.ts` is deliberately separate from `log.ts` even though the sink is its first consumer: the collector uses `pickState` without touching the sink, and keeping redaction pure makes the security-critical half testable without a filesystem.

---

### Task 1: Redaction

**Files:**
- Create: `packages/app/src/main/redact.ts`
- Test: `packages/app/test/redact.test.ts`

**Interfaces:**
- Consumes: `AppState` from `../shared/state.js`
- Produces: `scrubLine(s: string): string`, `pickState(state: AppState): Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { scrubLine, pickState } from '../src/main/redact.js'
import { INITIAL_STATE } from '../src/shared/state.js'

describe('scrubLine', () => {
  it('redacts Discord webhook URLs', () => {
    const out = scrubLine('POST https://discord.com/api/webhooks/123456/AbCdEf-_xyz failed')
    expect(out).toContain('<redacted>')
    expect(out).not.toContain('AbCdEf-_xyz')
  })

  it('redacts discordapp.com webhooks too', () => {
    expect(scrubLine('https://discordapp.com/api/webhooks/9/zzz')).not.toContain('zzz')
  })

  it('redacts bearer tokens', () => {
    expect(scrubLine('Authorization: Bearer ya29.a0Af')).toBe('Authorization: Bearer <redacted>')
  })

  it('redacts key query parameters', () => {
    expect(scrubLine('rtmp://a.rtmp.youtube.com/live2?key=abcd-1234')).toContain('key=<redacted>')
  })

  it('redacts the YouTube stream-key shape', () => {
    expect(scrubLine('using w1x2-y3z4-a5b6-c7d8-e9f0 now')).toContain('<redacted-stream-key>')
  })

  it('replaces the home directory with ~', () => {
    const home = process.env.HOME ?? ''
    if (!home) return
    expect(scrubLine(`reading ${home}/.var/app/x`)).toBe('reading ~/.var/app/x')
  })

  // A literal replace cannot be defeated by metacharacters; a regex could.
  it('replaces a home path containing regex metacharacters', () => {
    expect(scrubLine('at /home/a+b(c)/x', '/home/a+b(c)')).toBe('at ~/x')
  })

  it('leaves ordinary lines untouched', () => {
    expect(scrubLine('capture started at 1920x1080')).toBe('capture started at 1920x1080')
  })
})

describe('pickState', () => {
  it('includes diagnostic fields', () => {
    const out = pickState({ ...INITIAL_STATE, encoder: 'nvenc', videoBitrateKbps: 8000 })
    expect(out.encoder).toBe('nvenc')
    expect(out.videoBitrateKbps).toBe(8000)
    expect(out.phase).toBe('SETTING_UP')
  })

  it('omits every secret-bearing field', () => {
    const out = pickState({
      ...INITIAL_STATE,
      watchUrl: 'https://youtube.com/watch?v=secret',
      youtube: { connected: true, channel: 'Someone' },
      settings: { ...INITIAL_STATE.settings, discordWebhookUrl: 'https://discord.com/api/webhooks/1/x', discordMessage: 'hi' },
    })
    const json = JSON.stringify(out)
    expect(json).not.toContain('secret')
    expect(json).not.toContain('Someone')
    expect(json).not.toContain('webhooks')
    expect(json).not.toContain('hi')
    // connected is safe and useful; the channel name is not.
    expect(out.youtube).toEqual({ connected: true })
  })

  // The allowlist is the point: new AppState fields must not auto-ship.
  it('ignores fields it does not know about', () => {
    const out = pickState({ ...INITIAL_STATE, brandNewSecret: 'nope' } as never)
    expect(JSON.stringify(out)).not.toContain('nope')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd packages/app && npx vitest run test/redact.test.ts
```

Expected: FAIL — cannot resolve `../src/main/redact.js`.

- [ ] **Step 3: Implement**

```ts
import { homedir } from 'node:os'
import type { AppState } from '../shared/state.js'

const PATTERNS: Array<[RegExp, string]> = [
  [/https:\/\/discord(?:app)?\.com\/api\/webhooks\/\S+/gi, 'https://discord.com/api/webhooks/<redacted>'],
  [/Bearer\s+[\w.\-]+/gi, 'Bearer <redacted>'],
  [/\b(stream_key|key)=[^&\s]+/gi, '$1=<redacted>'],
  [/\b[a-z0-9]{4}(?:-[a-z0-9]{4}){4}\b/gi, '<redacted-stream-key>'],
]

/**
 * Write-time denylist for free-text log lines.
 *
 * `home` is a literal string replacement rather than a regex, so a path
 * containing regex metacharacters cannot defeat it. It is a parameter only so
 * tests can exercise that case.
 */
export function scrubLine(s: string, home: string = homedir()): string {
  let out = s
  for (const [re, to] of PATTERNS) out = out.replace(re, to)
  if (home) out = out.split(home).join('~')
  return out
}

/**
 * Field allowlist for the structured state dump.
 *
 * Deliberately an allowlist, not a denylist: a field added to AppState by a
 * later sub-project must not silently begin shipping in diagnostics bundles.
 */
export function pickState(state: AppState): Record<string, unknown> {
  return {
    phase: state.phase,
    encoder: state.encoder,
    videoBitrateKbps: state.videoBitrateKbps,
    capture: state.capture,
    stats: state.stats,
    liveUnconfirmed: state.liveUnconfirmed,
    error: state.error,
    audio: state.audio,
    masks: state.masks.map((m) => ({ x: m.x, y: m.y, w: m.w, h: m.h })),
    maskStyle: state.maskStyle,
    masksVisible: state.masksVisible,
    gameAudioPlugin: state.gameAudioPlugin,
    blurPlugin: state.blurPlugin,
    ptt: state.ptt,
    windowFitted: state.windowFitted,
    youtube: { connected: state.youtube.connected },
    settings: {
      titleTemplate: state.settings.titleTemplate,
      dateFormat: state.settings.dateFormat,
      privacy: state.settings.privacy,
    },
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd packages/app && npx vitest run test/redact.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/redact.ts packages/app/test/redact.test.ts
git commit -m "feat(diagnostics): add scrubLine denylist and pickState allowlist"
```

---

### Task 2: Rolling log sink

**Files:**
- Create: `packages/app/src/main/log.ts`
- Test: `packages/app/test/log.test.ts`

**Interfaces:**
- Consumes: `scrubLine` from Task 1 (injected, not imported, so the sink stays testable in isolation)
- Produces: `createLogSink(opts): LogSink`, `installLogSink(sink): () => void`, `type LogLevel = 'INFO' | 'WARN' | 'ERROR'`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLogSink, installLogSink } from '../src/main/log.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'axi-log-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('log sink', () => {
  it('writes a timestamped, levelled line', () => {
    const sink = createLogSink({ dir })
    sink.write('WARN', 'capture stalled')
    const body = readFileSync(sink.path, 'utf8')
    expect(body).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z WARN capture stalled$/m)
  })

  it('applies the scrub function before writing', () => {
    const sink = createLogSink({ dir, scrub: (s) => s.replace('secret', '<x>') })
    sink.write('INFO', 'a secret value')
    expect(readFileSync(sink.path, 'utf8')).toContain('a <x> value')
  })

  // Rotation is tested against a real filesystem; a mocked fs hides exactly
  // the ordering bugs rotation is prone to.
  it('rotates into a single backup once maxBytes is exceeded', () => {
    const sink = createLogSink({ dir, maxBytes: 200 })
    for (let i = 0; i < 40; i++) sink.write('INFO', `line ${i} ${'x'.repeat(20)}`)
    expect(existsSync(join(dir, 'axistream.log'))).toBe(true)
    expect(existsSync(join(dir, 'axistream.log.1'))).toBe(true)
    expect(existsSync(join(dir, 'axistream.log.2'))).toBe(false)
  })

  it('keeps only the newest backup when rotating twice', () => {
    const sink = createLogSink({ dir, maxBytes: 100 })
    for (let i = 0; i < 30; i++) sink.write('INFO', `${'y'.repeat(40)} ${i}`)
    const backup = readFileSync(join(dir, 'axistream.log.1'), 'utf8')
    expect(backup).not.toContain('y'.repeat(40) + ' 0')
  })

  it('never throws when the directory cannot be written', () => {
    const blocked = join(dir, 'blocked')
    writeFileSync(blocked, 'i am a file, not a directory')
    const sink = createLogSink({ dir: blocked })
    expect(() => sink.write('ERROR', 'boom')).not.toThrow()
  })

  it('tees console.warn to the sink and restores on dispose', () => {
    const sink = createLogSink({ dir })
    const restore = installLogSink(sink)
    console.warn('through the tee')
    restore()
    console.warn('after restore')
    const body = readFileSync(sink.path, 'utf8')
    expect(body).toContain('through the tee')
    expect(body).not.toContain('after restore')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd packages/app && npx vitest run test/log.test.ts
```

Expected: FAIL — cannot resolve `../src/main/log.js`.

- [ ] **Step 3: Implement**

```ts
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'INFO' | 'WARN' | 'ERROR'

export interface LogSink {
  write(level: LogLevel, message: string): void
  readonly path: string
  readonly backupPath: string
}

export interface LogSinkOptions {
  dir: string
  /** Rotate once the file exceeds this. One backup is kept, so the footprint is bounded at 2x. */
  maxBytes?: number
  scrub?: (s: string) => string
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

export function createLogSink(opts: LogSinkOptions): LogSink {
  const path = join(opts.dir, 'axistream.log')
  const backupPath = `${path}.1`
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const scrub = opts.scrub ?? ((s: string) => s)
  let ensured = false

  const rotate = (): void => {
    let size = 0
    try { size = statSync(path).size } catch { return }
    if (size <= maxBytes) return
    try { rmSync(backupPath, { force: true }) } catch { /* best effort */ }
    try { renameSync(path, backupPath) } catch { /* best effort */ }
  }

  return {
    path,
    backupPath,
    write(level, message) {
      // Swallows everything: a full disk must not take the app down.
      try {
        if (!ensured) { mkdirSync(opts.dir, { recursive: true }); ensured = true }
        rotate()
        appendFileSync(path, `${new Date().toISOString()} ${level} ${scrub(message)}\n`)
      } catch { /* logging must never be load-bearing */ }
    },
  }
}

const LEVELS: Array<[keyof Console, LogLevel]> = [['log', 'INFO'], ['warn', 'WARN'], ['error', 'ERROR']]

const format = (args: unknown[]): string => args
  .map((a) => a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : safeJson(a))
  .join(' ')

const safeJson = (v: unknown): string => {
  try { return JSON.stringify(v) ?? String(v) } catch { return String(v) }
}

/**
 * Tee console output into the sink, keeping the original console so `npm run
 * dev` is unchanged. Returns a restore function (used by tests; production
 * installs once for the process lifetime).
 */
export function installLogSink(sink: LogSink): () => void {
  const originals = LEVELS.map(([key]) => [key, console[key]] as const)
  for (const [key, level] of LEVELS) {
    const original = console[key] as (...a: unknown[]) => void
    ;(console as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => {
      original(...args)
      sink.write(level, format(args))
    }
  }
  return () => { for (const [key, fn] of originals) (console as unknown as Record<string, unknown>)[key] = fn }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd packages/app && npx vitest run test/log.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/log.ts packages/app/test/log.test.ts
git commit -m "feat(diagnostics): add rolling log sink with console tee"
```

---

### Task 3: Install the sink in main

**Files:**
- Modify: `packages/app/src/main/index.ts`

**Interfaces:**
- Consumes: `createLogSink`, `installLogSink` (Task 2), `scrubLine` (Task 1)
- Produces: a module-level `logSink` value that Task 5 reads for `logDir`

- [ ] **Step 1: Add the imports**

Alongside the other `./main/*` imports in `packages/app/src/main/index.ts`:

```ts
import { createLogSink, installLogSink } from './log.js'
import { scrubLine } from './redact.js'
```

- [ ] **Step 2: Install it before anything else runs**

`app.getPath('logs')` is already the directory `updater.ts:46` writes to, so the bundle picks up both files from one place. Install as early in the module body as `app` is usable — ahead of OBS provisioning, so boot failures fall inside the window:

```ts
const logSink = createLogSink({ dir: app.getPath('logs'), scrub: scrubLine })
installLogSink(logSink)
```

Place this immediately after the existing `const userData = app.getPath('userData')` line (`index.ts:163`) if that is inside the boot function; if the surrounding code makes an earlier placement possible without touching `app` before it is ready, prefer earlier.

- [ ] **Step 3: Verify by hand**

```bash
cd packages/app && npx tsc --noEmit -p tsconfig.json
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main/index.ts
git commit -m "feat(diagnostics): tee main-process logging to disk"
```

---

### Task 4: Expose configRoot and route OBS output into the sink

**Files:**
- Modify: `packages/capture/src/owned-obs-runtime.ts`
- Modify: `packages/capture/src/linux-owned-obs-runtime.ts:106`
- Modify: `packages/capture/src/windows-owned-obs-runtime.ts:186`
- Modify: `packages/capture/src/obs-launcher.ts:45-46`
- Modify: `packages/capture/src/headless-cage-launcher.ts:28-29`
- Modify: `packages/capture/src/windows-obs-launcher.ts:156-157`
- Test: `packages/capture/test/launcher-output.test.ts`

**Interfaces:**
- Produces: `OwnedObsRuntime.configRoot: string`, consumed by Task 5's `obsConfigRoot`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { FlatpakObsLauncher } from '../src/obs-launcher.js'

const fakeChild = () => {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = () => {}
  return proc
}

describe('OBS launcher output', () => {
  it('routes flatpak stdout through console so the log sink captures it', () => {
    const proc = fakeChild()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const launcher = new FlatpakObsLauncher(undefined, (() => proc) as never)
    launcher.launch([])
    proc.stdout.emit('data', Buffer.from('obs booting'))
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[obs] obs booting'))
    spy.mockRestore()
  })

  it('routes flatpak stderr through console.warn', () => {
    const proc = fakeChild()
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const launcher = new FlatpakObsLauncher(undefined, (() => proc) as never)
    launcher.launch([])
    proc.stderr.emit('data', Buffer.from('a warning'))
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[obs] a warning'))
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd packages/capture && npx vitest run test/launcher-output.test.ts
```

Expected: FAIL — output still goes to `process.stdout`, so the spies never fire.

- [ ] **Step 3: Route the Linux launchers through console**

In `packages/capture/src/obs-launcher.ts`, replace lines 45-46:

```ts
    proc.stdout?.on('data', (d) => console.log(`[obs] ${String(d).trimEnd()}`))
    proc.stderr?.on('data', (d) => console.warn(`[obs] ${String(d).trimEnd()}`))
```

Make the identical change in `packages/capture/src/headless-cage-launcher.ts` lines 28-29 (note: `proc.stdout` is non-optional there, so drop the `?.`).

This keeps `@axistream/capture` decoupled — it depends on `console`, not on the app's sink.

- [ ] **Step 4: Pipe and drain Windows**

In `packages/capture/src/windows-obs-launcher.ts`, change the spawn options at line 157 from `stdio: 'ignore'` to `stdio: ['ignore', 'pipe', 'pipe']`, then attach handlers **immediately** after the spawn returns, before anything else:

```ts
    const child = this.spawn(this.options.executablePath, launchArgs, {
      cwd: win32.dirname(this.options.executablePath), stdio: ['ignore', 'pipe', 'pipe'], detached: false,
      // ...keep every other existing option unchanged
    })
    // Attached at spawn, not later: an undrained pipe blocks a chatty OBS.
    child.stdout?.on('data', (d) => console.log(`[obs] ${String(d).trimEnd()}`))
    child.stderr?.on('data', (d) => console.warn(`[obs] ${String(d).trimEnd()}`))
```

- [ ] **Step 5: Add `configRoot` to the interface**

In `packages/capture/src/owned-obs-runtime.ts`:

```ts
export interface OwnedObsRuntime {
  readonly engineId: string
  readonly configIdentity: string
  /** OBS's config directory; `<configRoot>/obs-studio/logs` holds OBS's own logs. */
  readonly configRoot: string
  prepare(): Promise<OwnedObsLaunchSpec>
}
```

In `LinuxOwnedObsRuntime`, add `readonly configRoot: string` and set it in the constructor beside `configIdentity`:

```ts
    this.configRoot = join(homedir(), '.var', 'app', options.manifest.appId, 'config')
```

then replace the inline expression at line 106 with `this.configRoot`.

In `WindowsOwnedObsRuntime`, add `readonly configRoot: string` and set it in the constructor:

```ts
    this.configRoot = join(options.installRoot, options.manifest.obsVersion, 'config')
```

then use `this.configRoot` in `launchSpec` instead of `join(target, 'config')`.

- [ ] **Step 6: Run the capture suite**

```bash
npm -w @axistream/capture run test
```

Expected: PASS, including the two new tests. Existing runtime tests that construct these classes should be unaffected — `configRoot` is derived from options they already pass.

- [ ] **Step 7: Commit**

```bash
git add packages/capture/src packages/capture/test/launcher-output.test.ts
git commit -m "feat(capture): expose configRoot and route OBS output through console"
```

---

### Task 5: Diagnostics collector

**Files:**
- Create: `packages/app/src/main/diagnostics.ts`
- Modify: `packages/app/package.json` (add `archiver` + `@types/archiver`)
- Test: `packages/app/test/diagnostics.test.ts`

**Interfaces:**
- Consumes: `pickState` (Task 1), `LogSink.path`/`backupPath` (Task 2), `OwnedObsRuntime.configRoot` (Task 4)
- Produces: `collectDiagnostics(d: DiagnosticsDeps): Promise<DiagnosticsResult>`

- [ ] **Step 1: Add the dependency**

```bash
npm -w @axistream/app install archiver
npm -w @axistream/app install -D @types/archiver
```

`archiver` is already resolved in the lockfile as an electron-builder transitive, so this promotes it to an explicit dependency rather than introducing new supply-chain surface. electron-builder only packages declared `dependencies`, which is why the promotion is required.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { collectDiagnostics } from '../src/main/diagnostics.js'
import { INITIAL_STATE } from '../src/shared/state.js'

let root: string
const versions = { app: '0.1.15', electron: '31.0.0', node: '20.0.0', os: 'linux 6.1' }

const deps = (over: Partial<Parameters<typeof collectDiagnostics>[0]> = {}) => ({
  outDir: join(root, 'out'),
  logDir: join(root, 'logs'),
  obsConfigRoot: join(root, 'obscfg'),
  client: () => ({ call: async () => ({ scenes: [], inputs: [] }) }) as never,
  state: () => INITIAL_STATE,
  versions,
  ...over,
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'axi-diag-'))
  mkdirSync(join(root, 'logs'), { recursive: true })
  writeFileSync(join(root, 'logs', 'axistream.log'), 'hello log\n')
  mkdirSync(join(root, 'obscfg', 'obs-studio', 'logs'), { recursive: true })
  writeFileSync(join(root, 'obscfg', 'obs-studio', 'logs', '2026-08-24.txt'), 'obs log\n')
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('collectDiagnostics', () => {
  it('writes a zip and reports its path', async () => {
    const r = await collectDiagnostics(deps())
    expect(r.ok).toBe(true)
    expect(r.path).toMatch(/axistream-diagnostics-\d{8}-\d{6}\.zip$/)
    expect(existsSync(r.path!)).toBe(true)
  })

  // The whole point: diagnostics get collected when things are broken.
  it('still produces a zip when OBS is unreachable', async () => {
    const r = await collectDiagnostics(deps({ client: () => { throw new Error('no obs') } }))
    expect(r.ok).toBe(true)
    expect(existsSync(r.path!)).toBe(true)
  })

  it('succeeds when the OBS config root is missing', async () => {
    const r = await collectDiagnostics(deps({ obsConfigRoot: join(root, 'nope') }))
    expect(r.ok).toBe(true)
  })

  it('succeeds when there is no OBS client at all', async () => {
    const r = await collectDiagnostics(deps({ client: () => null }))
    expect(r.ok).toBe(true)
  })

  it('prunes to the five most recent bundles', async () => {
    const out = join(root, 'out')
    mkdirSync(out, { recursive: true })
    for (let i = 0; i < 8; i++) writeFileSync(join(out, `axistream-diagnostics-2026010${i}-000000.zip`), 'x')
    await collectDiagnostics(deps())
    expect(readdirSync(out).filter((f) => f.endsWith('.zip')).length).toBe(5)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd packages/app && npx vitest run test/diagnostics.test.ts
```

Expected: FAIL — cannot resolve `../src/main/diagnostics.js`.

- [ ] **Step 4: Implement**

```ts
import archiver from 'archiver'
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pickState, scrubLine } from './redact.js'
import type { AppState } from '../shared/state.js'

interface ObsClientLike { call(request: string, data?: unknown): Promise<unknown> }

export interface DiagnosticsDeps {
  outDir: string
  logDir: string
  obsConfigRoot: string | null
  client: () => ObsClientLike | null
  state: () => AppState
  versions: { app: string; electron: string; node: string; os: string }
}

export interface DiagnosticsResult { ok: boolean; path?: string; error?: string }

/** Keep the newest N bundles so a debugging session cannot grow without bound. */
const KEEP = 5

const stamp = (d = new Date()): string => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const scrubJson = (v: unknown): string => scrubLine(JSON.stringify(v, null, 2))

export async function collectDiagnostics(d: DiagnosticsDeps): Promise<DiagnosticsResult> {
  try {
    mkdirSync(d.outDir, { recursive: true })
    const path = join(d.outDir, `axistream-diagnostics-${stamp()}.zip`)
    const zip = archiver('zip', { zlib: { level: 9 } })
    const out = createWriteStream(path)
    const done = new Promise<void>((resolve, reject) => {
      out.on('close', () => resolve())
      zip.on('error', reject)
    })
    zip.pipe(out)

    // Every source is independently best-effort: a collector that dies because
    // OBS is unreachable is useless in exactly the case it exists for.
    const attempt = async (name: string, fn: () => Promise<string> | string): Promise<void> => {
      try { zip.append(await fn(), { name }) }
      catch (e) { zip.append(`${e instanceof Error ? e.message : String(e)}\n`, { name: `${name}.error.txt` }) }
    }

    await attempt('report.json', () => scrubJson({
      generatedAt: new Date().toISOString(),
      versions: d.versions,
      platform: process.platform,
      arch: process.arch,
      state: pickState(d.state()),
    }))

    for (const file of ['axistream.log', 'axistream.log.1', 'updater.log']) {
      const full = join(d.logDir, file)
      if (existsSync(full)) zip.file(full, { name: file })
    }

    if (d.obsConfigRoot) {
      const obsLogs = join(d.obsConfigRoot, 'obs-studio', 'logs')
      try {
        const recent = readdirSync(obsLogs)
          .filter((f) => f.endsWith('.txt'))
          .map((f) => ({ f, t: statSync(join(obsLogs, f)).mtimeMs }))
          .sort((a, b) => b.t - a.t)
          .slice(0, 3)
        for (const { f } of recent) zip.file(join(obsLogs, f), { name: `obs/${f}` })
      } catch { /* no OBS logs is not a failure */ }
    }

    const client = safeClient(d)
    if (client) {
      await attempt('obs/scenes.json', async () => {
        const list = await client.call('GetSceneList') as { scenes: Array<{ sceneName: string }> }
        const scenes = []
        for (const s of list.scenes ?? []) {
          const items = await client.call('GetSceneItemList', { sceneName: s.sceneName })
          scenes.push({ scene: s.sceneName, items })
        }
        return scrubJson(scenes)
      })
      await attempt('obs/inputs.json', async () => {
        const list = await client.call('GetInputList') as { inputs: Array<{ inputName: string }> }
        const inputs = []
        for (const i of list.inputs ?? []) {
          const settings = await client.call('GetInputSettings', { inputName: i.inputName })
          inputs.push({ input: i.inputName, settings })
        }
        return scrubJson(inputs)
      })
    } else {
      zip.append('OBS was not connected when diagnostics were collected.\n', { name: 'obs/scenes.error.txt' })
    }

    await zip.finalize()
    await done
    prune(d.outDir)
    return { ok: true, path }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

const safeClient = (d: DiagnosticsDeps): ObsClientLike | null => {
  try { return d.client() } catch { return null }
}

function prune(dir: string): void {
  try {
    const zips = readdirSync(dir)
      .filter((f) => f.startsWith('axistream-diagnostics-') && f.endsWith('.zip'))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const { f } of zips.slice(KEEP)) rmSync(join(dir, f), { force: true })
  } catch { /* pruning is housekeeping, never fatal */ }
}
```

- [ ] **Step 5: Run it and watch it pass**

```bash
cd packages/app && npx vitest run test/diagnostics.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/main/diagnostics.ts packages/app/test/diagnostics.test.ts packages/app/package.json package-lock.json
git commit -m "feat(diagnostics): add best-effort bundle collector"
```

---

### Task 6: IPC channel and handler

**Files:**
- Modify: `packages/app/src/shared/state.ts` (add to `CH` and `AxiApi`)
- Modify: `packages/app/src/main/ipc.ts` (add to `IpcHandlers` and `registerIpc`)
- Modify: `packages/app/src/preload/index.ts`
- Modify: `packages/app/src/main/index.ts` (implement the handler)
- Test: `packages/app/test/ipc-contract.test.ts`

**Interfaces:**
- Consumes: `collectDiagnostics` (Task 5), `logSink` (Task 3), `runtime.configRoot` (Task 4)
- Produces: `axi.exportDiagnostics(): Promise<DiagnosticsResult>` for Tasks 7 and 8

- [ ] **Step 1: Extend the contract test**

Add to `packages/app/test/ipc-contract.test.ts`, matching the existing cases' shape:

```ts
  it('registers the diagnostics export channel', () => {
    expect(CH.exportDiagnostics).toBe('axi:exportDiagnostics')
    const handled: string[] = []
    registerIpc({
      ipcMain: { handle: (ch: string) => { handled.push(ch) } },
      handlers: {} as never,
      bindPush: () => {},
    })
    expect(handled).toContain(CH.exportDiagnostics)
  })
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd packages/app && npx vitest run test/ipc-contract.test.ts
```

Expected: FAIL — `CH.exportDiagnostics` is undefined.

- [ ] **Step 3: Add the shared contract**

In `packages/app/src/shared/state.ts`, add beside `DiscordTestResult`:

```ts
export interface DiagnosticsResult { ok: boolean; path?: string; error?: string }
```

Add to `CH`, after `copyToClipboard`:

```ts
  exportDiagnostics: 'axi:exportDiagnostics',
```

Add to `AxiApi`, after `copyToClipboard`:

```ts
  exportDiagnostics(): Promise<DiagnosticsResult>
```

- [ ] **Step 4: Wire ipc.ts**

Add `DiagnosticsResult` to the type import at the top, then add to `IpcHandlers`:

```ts
  exportDiagnostics(): Promise<DiagnosticsResult>
```

and to `registerIpc`, beside the `copyToClipboard` registration:

```ts
  ipcMain.handle(CH.exportDiagnostics, () => handlers.exportDiagnostics())
```

- [ ] **Step 5: Wire the preload**

Add `type DiagnosticsResult` to the line-2 import, and beside `copyToClipboard`:

```ts
  exportDiagnostics: () => ipcRenderer.invoke(CH.exportDiagnostics) as Promise<DiagnosticsResult>,
```

- [ ] **Step 6: Implement the handler**

In `packages/app/src/main/index.ts`, add the import:

```ts
import { collectDiagnostics } from './diagnostics.js'
```

and add the handler alongside the others. It takes no arguments, so it works from a renderer whose tree has partly collapsed:

```ts
    exportDiagnostics: async () => {
      const r = await collectDiagnostics({
        outDir: join(userData, 'diagnostics'),
        logDir: app.getPath('logs'),
        obsConfigRoot: runtime.configRoot,
        client: () => sidecar.client(),
        state: () => getState(),
        versions: {
          app: app.getVersion(),
          electron: process.versions.electron,
          node: process.versions.node,
          os: `${process.platform} ${release()}`,
        },
      })
      toast(win, r.ok
        ? { kind: 'success', message: 'Diagnostics exported', detail: r.path }
        : { kind: 'error', message: 'Diagnostics export failed', detail: r.error })
      return r
    },
```

Add `import { release } from 'node:os'` if not already present. Use whatever the surrounding code calls the current-state getter — if there is no `getState()`, use the same expression the `getInitialState` handler returns.

- [ ] **Step 7: Run the suite**

```bash
npm -w @axistream/app run test
```

Expected: PASS, all files.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src
git commit -m "feat(diagnostics): add exportDiagnostics IPC channel"
```

---

### Task 7: Settings panel

**Files:**
- Create: `packages/app/src/renderer/components/DiagnosticsSettings.tsx`
- Modify: `packages/app/src/renderer/components/SettingsScreen.tsx`
- Test: `packages/app/test/diagnostics-settings.test.tsx`

**Interfaces:**
- Consumes: `axi.exportDiagnostics()` (Task 6)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiagnosticsSettings } from '../src/renderer/components/DiagnosticsSettings.js'

const api = (r = { ok: true, path: '/tmp/x.zip' }) =>
  ({ exportDiagnostics: vi.fn().mockResolvedValue(r) }) as never

describe('DiagnosticsSettings', () => {
  it('states what the bundle excludes, so the user can trust it', () => {
    render(<DiagnosticsSettings axi={api()} />)
    expect(screen.getByText(/stream key/i)).toBeInTheDocument()
  })

  it('calls exportDiagnostics on click', async () => {
    const axi = api()
    render(<DiagnosticsSettings axi={axi} />)
    await userEvent.click(screen.getByRole('button', { name: /export diagnostics/i }))
    await waitFor(() => expect(axi.exportDiagnostics).toHaveBeenCalled())
  })

  it('disables the button while collecting', async () => {
    let release: (v: unknown) => void = () => {}
    const axi = { exportDiagnostics: vi.fn(() => new Promise((r) => { release = r })) } as never
    render(<DiagnosticsSettings axi={axi} />)
    const btn = screen.getByRole('button', { name: /export diagnostics/i })
    await userEvent.click(btn)
    await waitFor(() => expect(btn).toBeDisabled())
    release({ ok: true, path: '/tmp/x.zip' })
    await waitFor(() => expect(btn).not.toBeDisabled())
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd packages/app && npx vitest run test/diagnostics-settings.test.tsx
```

Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react'
import type { AxiApi } from '../../shared/state.js'

export function DiagnosticsSettings({ axi }: { axi: AxiApi }) {
  const [busy, setBusy] = useState(false)

  const run = async (): Promise<void> => {
    setBusy(true)
    // The result is reported through the toast channel from main, so there is
    // nothing to render here beyond the busy state.
    try { await axi.exportDiagnostics() } finally { setBusy(false) }
  }

  return (
    <>
      <h3>Diagnostics</h3>
      <p className="muted">
        Bundles the app log, OBS&apos;s logs, and your encoder and device settings into a zip
        you can send us. Your stream key, YouTube sign-in, and Discord webhook are left out.
      </p>
      <button className="btn ghost" disabled={busy} onClick={() => void run()}>
        {busy ? 'Collecting…' : 'Export diagnostics'}
      </button>
    </>
  )
}
```

- [ ] **Step 4: Mount it in Settings**

In `packages/app/src/renderer/components/SettingsScreen.tsx`, add the import and a section after the Capture section:

```tsx
          <section className="setting">
            <DiagnosticsSettings axi={axi} />
          </section>
```

- [ ] **Step 5: Run it and watch it pass**

```bash
cd packages/app && npx vitest run test/diagnostics-settings.test.tsx
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer packages/app/test/diagnostics-settings.test.tsx
git commit -m "feat(diagnostics): add Settings export panel"
```

---

### Task 8: Export from the crash boundary

**Files:**
- Modify: `packages/app/src/renderer/components/ErrorBoundary.tsx`
- Test: `packages/app/test/error-boundary.test.tsx`

**Interfaces:**
- Consumes: `axi.exportDiagnostics()` (Task 6)

- [ ] **Step 1: Extend the existing boundary test**

Add a case to `packages/app/test/error-boundary.test.tsx`, following the file's existing throwing-child helper:

```tsx
  it('exports diagnostics from the crash screen', async () => {
    const exportDiagnostics = vi.fn().mockResolvedValue({ ok: true, path: '/tmp/x.zip' })
    stubAxi({ exportDiagnostics })
    render(<ErrorBoundary label="Settings"><Boom /></ErrorBoundary>)
    await userEvent.click(screen.getByRole('button', { name: /export diagnostics/i }))
    await waitFor(() => expect(exportDiagnostics).toHaveBeenCalled())
  })
```

Use whatever the file already does to stub `window.axi` rather than inventing `stubAxi` — match the existing `copyToClipboard` case.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd packages/app && npx vitest run test/error-boundary.test.tsx
```

Expected: FAIL — no button matches `/export diagnostics/i`.

- [ ] **Step 3: Implement**

Add a handler beside `copy`:

```ts
  private exportDiagnostics = async (): Promise<void> => {
    // Argument-free by design: this tree has already partly collapsed.
    await axi().exportDiagnostics().catch(() => ({ ok: false }))
  }
```

and a third button in `crash-actions`, after "Copy error details":

```tsx
          <button className="btn ghost" onClick={() => void this.exportDiagnostics()}>Export diagnostics</button>
```

Leave the deliberate absence of a Restart button alone — restarting is still the action most likely to cost someone a live broadcast.

- [ ] **Step 4: Run it and watch it pass**

```bash
cd packages/app && npx vitest run test/error-boundary.test.tsx
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/renderer/components/ErrorBoundary.tsx packages/app/test/error-boundary.test.tsx
git commit -m "feat(diagnostics): export from the crash boundary"
```

---

### Task 9: Gates and merge

- [ ] **Step 1: Full automated gates**

```bash
npm -w @axistream/app run test
npm -w @axistream/capture run test
cd packages/app && npx tsc --noEmit -p tsconfig.json
```

Expected: all pass, typecheck clean.

- [ ] **Step 2: Build gate**

Required because `archiver` is a new main-process dependency, and the packaged bundle is where such deps break rather than the test suite.

```bash
npm run build
```

Expected: succeeds. If `archiver` fails to resolve in the packaged main bundle, check that it is in `dependencies` (not `devDependencies`) in `packages/app/package.json`, and that the electron-builder config is not excluding it.

- [ ] **Step 3: Manual smoke**

Run `npm run dev` and confirm:
- Settings shows the Diagnostics panel; clicking Export produces a success toast whose detail is a real path.
- Open that zip: `report.json` exists, contains no `discordWebhookUrl` and no `watchUrl`, and paths show as `~/…` rather than your home directory.
- `axistream.log` in the bundle contains `[obs]` lines from OBS's own output.
- Export twice in a row and confirm both zips land in `<userData>/diagnostics/`.

- [ ] **Step 4: Merge**

```bash
git checkout main
git merge --no-ff feat/diagnostics-export -m "Merge feat/diagnostics-export: rolling log, redaction, bundle export"
```
