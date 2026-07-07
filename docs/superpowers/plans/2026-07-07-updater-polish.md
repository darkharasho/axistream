# Auto-Updater Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer axibridge's updater UX onto our electron-updater setup — retryable errors with friendly messages, a manual Check-for-updates Settings section, and a What's-new release-notes view.

**Architecture:** Two pure modules (`autoupdate-errors.ts`, `version-notes.ts`) carry the logic; `updater.ts` gains a retry-once wrapper on the `error` event + friendly formatting; new IPC (`app:version`, `getWhatsNew`, `setLastSeenVersion`) feeds a new Updates section in SettingsScreen. electron-updater, the GearLever workaround, and the hourly poll are unchanged.

**Tech Stack:** Electron 31 main/renderer, TypeScript 5.5 (ESM/NodeNext), Vitest 2 (fork pool ≤2). No new dependencies.

## Global Constraints

- 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on all relative imports.
- Best-effort everywhere: the notes fetch, version IPC, and retry logic never throw out or block boot/the existing auto-flow.
- Retry: exactly ONE re-check, after 2000 ms, on a retryable error; counter resets on any non-error lifecycle event.
- Retryable classes (substring match, case-insensitive): `err_http2_server_refused_stream`, `econnreset`, `etimedout`, `socket hang up`, `timed out`, `timeout`, `error: 502`, `error: 503`, `error: 504`.
- Release-notes source: `https://api.github.com/repos/darkharasho/axistream/releases?per_page=100` (no bundled RELEASE_NOTES.md).
- `lastSeenVersion` is a StreamSettings field, default `''`.
- Do NOT remove the existing sidebar "Update ready" pill or the AppImage-ENOENT error message (keep it as a non-retryable friendly case).
- IMPLEMENTER GATES every task: focused vitest, FULL `npm -w @axistream/app run test`, FULL `cd packages/app && npx tsc --noEmit -p tsconfig.json`.
- vitest: `npm -w @axistream/app run test`.

---

### Task 1: autoupdate-errors (pure) + retry wiring

**Files:**
- Create: `packages/app/src/shared/autoupdate-errors.ts`
- Modify: `packages/app/src/main/updater.ts` (the `error` handler + reset points)
- Test: `packages/app/test/autoupdate-errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
```ts
export function extractAutoUpdateErrorMessage(err: unknown): string
export function isRetryableAutoUpdateError(err: unknown): boolean
export function formatAutoUpdateErrorMessage(err: unknown): string
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/test/autoupdate-errors.test.ts
import { describe, it, expect } from 'vitest'
import { extractAutoUpdateErrorMessage, isRetryableAutoUpdateError, formatAutoUpdateErrorMessage } from '../src/shared/autoupdate-errors.js'

describe('extractAutoUpdateErrorMessage', () => {
  it('reads string, Error, and object-with-message', () => {
    expect(extractAutoUpdateErrorMessage('boom')).toBe('boom')
    expect(extractAutoUpdateErrorMessage(new Error('nope'))).toBe('nope')
    expect(extractAutoUpdateErrorMessage({ message: 'x' })).toBe('x')
    expect(extractAutoUpdateErrorMessage(null)).toBe('')
  })
})

describe('isRetryableAutoUpdateError', () => {
  it('true for transient network classes', () => {
    for (const m of ['ERR_HTTP2_SERVER_REFUSED_STREAM', 'ECONNRESET', 'ETIMEDOUT', 'socket hang up', 'Request timed out', 'Error: 503']) {
      expect(isRetryableAutoUpdateError(new Error(m))).toBe(true)
    }
  })
  it('false for a real failure', () => {
    expect(isRetryableAutoUpdateError(new Error('ENOENT unlink /x.AppImage'))).toBe(false)
  })
})

describe('formatAutoUpdateErrorMessage', () => {
  it('maps each class to friendly copy', () => {
    expect(formatAutoUpdateErrorMessage(new Error('ERR_HTTP2_SERVER_REFUSED_STREAM'))).toMatch(/refused the download stream/i)
    expect(formatAutoUpdateErrorMessage(new Error('Error: 503 releases.atom github.com'))).toMatch(/GitHub temporarily failed/i)
    expect(formatAutoUpdateErrorMessage(new Error('Request timed out'))).toMatch(/timed out/i)
    expect(formatAutoUpdateErrorMessage(new Error('ECONNRESET'))).toMatch(/temporary network error/i)
  })
  it('falls back to the summarized first line', () => {
    expect(formatAutoUpdateErrorMessage(new Error('Weird thing happened\nstack line'))).toBe('Weird thing happened')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm -w @axistream/app run test -- autoupdate-errors`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the module**

```ts
// packages/app/src/shared/autoupdate-errors.ts
const readErrorMessage = (err: unknown): string => {
  if (!err) return ''
  if (typeof err === 'string') return err
  if (typeof err === 'object') {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string') return message
    const stack = (err as { stack?: unknown }).stack
    if (typeof stack === 'string' && stack.trim()) return stack.split('\n')[0].trim()
  }
  return ''
}

const summarize = (message: string): string => {
  const firstLine = String(message || '').split(/(?:\\n|[\r\n])+/)[0]?.trim() || ''
  if (!firstLine) return ''
  const dataIndex = firstLine.toLowerCase().indexOf(' data:')
  return dataIndex > -1 ? firstLine.slice(0, dataIndex).trim() : firstLine
}

export function extractAutoUpdateErrorMessage(err: unknown): string {
  return readErrorMessage(err) || (err ? 'Unknown update error' : '')
}

export function isRetryableAutoUpdateError(err: unknown): boolean {
  const m = extractAutoUpdateErrorMessage(err).toLowerCase()
  return m.includes('err_http2_server_refused_stream')
    || m.includes('econnreset') || m.includes('etimedout') || m.includes('socket hang up')
    || m.includes('timed out') || m.includes('timeout')
    || m.includes('error: 502') || m.includes('error: 503') || m.includes('error: 504')
}

export function formatAutoUpdateErrorMessage(err: unknown): string {
  const message = extractAutoUpdateErrorMessage(err)
  const n = message.toLowerCase()
  if (n.includes('err_http2_server_refused_stream')) return 'The update server temporarily refused the download stream. Please try again in a moment.'
  if ((n.includes('error: 502') || n.includes('error: 503') || n.includes('error: 504')) && (n.includes('releases.atom') || n.includes('github.com'))) return 'GitHub temporarily failed to respond to the update check. Please try again in a moment.'
  if (n.includes('timed out') || n.includes('timeout')) return 'The update check timed out before the server responded. Please try again.'
  if (n.includes('econnreset') || n.includes('etimedout') || n.includes('socket hang up')) return 'A temporary network error interrupted the update check. Please try again.'
  return summarize(message) || message
}
```

- [ ] **Step 4: Wire the retry into updater.ts**

Add the import at the top of `updater.ts`:
```ts
import { isRetryableAutoUpdateError, formatAutoUpdateErrorMessage } from '../shared/autoupdate-errors.js'
```
Inside `setupUpdater`, before the event registrations, add retry state:
```ts
  let retryAttempts = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  const resetRetry = () => { retryAttempts = 0; if (retryTimer) { clearTimeout(retryTimer); retryTimer = null } }
```
Call `resetRetry()` at the top of the `checking-for-update`, `update-available`, `update-not-available`, `download-progress`, and `update-downloaded` handlers (one line each). Replace the `error` handler body with:
```ts
  autoUpdater.on('error', (err) => {
    ulog.error('updater error:', err)
    const raw = err?.message ?? String(err)
    // AppImage swap ENOENT is a real, non-retryable failure — keep its specific copy.
    if (/ENOENT|APPIMAGE|unlink/i.test(raw)) {
      send({ state: 'error', message: 'Update downloaded, but the app could not replace its AppImage automatically — the running file may have been moved or removed. Reinstall the latest AppImage from the Releases page.' })
      return
    }
    if (isRetryableAutoUpdateError(err) && retryAttempts < 1) {
      retryAttempts += 1
      ulog.warn(`retryable update error, retrying in 2s (${retryAttempts}/1): ${raw}`)
      send({ state: 'checking' })
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = setTimeout(() => void autoUpdater.checkForUpdates().catch(() => {}), 2000)
      return
    }
    send({ state: 'error', message: formatAutoUpdateErrorMessage(err) })
  })
```

- [ ] **Step 5: Full gates + commit**

Run: `npm -w @axistream/app run test -- autoupdate-errors` → PASS. Then FULL `npm -w @axistream/app run test` and FULL tsc → clean.
```bash
git add packages/app/src/shared/autoupdate-errors.ts packages/app/src/main/updater.ts packages/app/test/autoupdate-errors.test.ts
git commit -m "feat(updater): retryable-error retry + friendly messages"
```

---

### Task 2: version-notes (pure) + notes/version IPC

**Files:**
- Create: `packages/app/src/main/version-notes.ts`
- Modify: `packages/app/src/main/StreamSettings.ts` (`lastSeenVersion` field), `packages/app/src/shared/state.ts` (CH + AxiApi), `packages/app/src/main/ipc.ts`, `packages/app/src/preload/index.ts`, `packages/app/src/main/index.ts` (handlers)
- Test: `packages/app/test/version-notes.test.ts`, append to `stream-settings.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
```ts
export interface GithubRelease { tag: string; body: string }
export function parseVersion(v: string | null | undefined): number[] | null
export function compareVersion(a: number[], b: number[]): number
export function selectReleaseNotes(releases: GithubRelease[], currentVersion: string, lastSeenVersion: string | null): string | null
// IPC: appVersion(): Promise<string>; getWhatsNew(): Promise<{ version: string; notes: string | null }>; setLastSeenVersion(v: string): Promise<void>
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/test/version-notes.test.ts
import { describe, it, expect } from 'vitest'
import { parseVersion, compareVersion, selectReleaseNotes } from '../src/main/version-notes.js'

describe('parseVersion', () => {
  it('parses with/without v and rejects garbage', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('0.1.4')).toEqual([0, 1, 4])
    expect(parseVersion('nope')).toBeNull()
    expect(parseVersion(null)).toBeNull()
  })
})

describe('compareVersion', () => {
  it('orders correctly', () => {
    expect(compareVersion([0, 1, 4], [0, 1, 3])).toBeGreaterThan(0)
    expect(compareVersion([0, 1, 3], [0, 2, 0])).toBeLessThan(0)
    expect(compareVersion([1, 0, 0], [1, 0, 0])).toBe(0)
  })
})

describe('selectReleaseNotes', () => {
  const rels = [
    { tag: 'v0.1.4', body: 'four' },
    { tag: 'v0.1.3', body: 'three' },
    { tag: 'v0.1.2', body: 'two' },
  ]
  it('returns notes newer than lastSeen up to current, newest first', () => {
    const out = selectReleaseNotes(rels, '0.1.4', '0.1.2')
    expect(out).toContain('four')
    expect(out).toContain('three')
    expect(out).not.toContain('two')
    expect(out!.indexOf('four')).toBeLessThan(out!.indexOf('three'))
  })
  it('excludes releases newer than current', () => {
    const out = selectReleaseNotes([{ tag: 'v0.2.0', body: 'future' }, ...rels], '0.1.4', '0.1.3')
    expect(out).not.toContain('future')
    expect(out).toContain('four')
  })
  it('null when nothing in range', () => {
    expect(selectReleaseNotes(rels, '0.1.2', '0.1.2')).toBeNull()
  })
  it('no lastSeen → everything up to current', () => {
    expect(selectReleaseNotes(rels, '0.1.4', null)).toContain('two')
  })
})
```
Append to stream-settings.test.ts:
```ts
  it('defaults lastSeenVersion to empty and round-trips it', () => {
    const s = new StreamSettings(file)
    expect(s.load().lastSeenVersion).toBe('')
    s.patch({ lastSeenVersion: '0.1.4' })
    expect(new StreamSettings(file).load().lastSeenVersion).toBe('0.1.4')
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm -w @axistream/app run test -- version-notes stream-settings`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/main/version-notes.ts
export interface GithubRelease { tag: string; body: string }

export function parseVersion(v: string | null | undefined): number[] | null {
  if (!v) return null
  const parts = v.trim().replace(/^v/i, '').split('.').map((p) => Number.parseInt(p, 10))
  if (parts.some((n) => Number.isNaN(n))) return null
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
}

export function compareVersion(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

/** GitHub-releases entries strictly newer than lastSeen and <= current,
 *  newest first, concatenated as markdown. null when the range is empty. */
export function selectReleaseNotes(releases: GithubRelease[], currentVersion: string, lastSeenVersion: string | null): string | null {
  const current = parseVersion(currentVersion)
  if (!current) return null
  const lastSeen = parseVersion(lastSeenVersion)
  const picked = releases
    .map((r) => ({ v: parseVersion(r.tag), r }))
    .filter((x): x is { v: number[]; r: GithubRelease } => x.v !== null)
    .filter((x) => compareVersion(x.v, current) <= 0 && (!lastSeen || compareVersion(x.v, lastSeen) > 0))
    .sort((a, b) => compareVersion(b.v, a.v))
  if (picked.length === 0) return null
  return picked.map((x) => `## ${x.r.tag}\n\n${x.r.body}`.trim()).join('\n\n')
}
```

`StreamSettings.ts` — add `lastSeenVersion: string` after `pttKeyName`; DEFAULT `lastSeenVersion: ''`; sanitize `typeof raw.lastSeenVersion === 'string' ? raw.lastSeenVersion : DEFAULT_SETTINGS.lastSeenVersion`.

`state.ts` CH: `appVersion: 'app:version', getWhatsNew: 'app:getWhatsNew', setLastSeenVersion: 'app:setLastSeenVersion',`; AxiApi: `appVersion(): Promise<string>`, `getWhatsNew(): Promise<{ version: string; notes: string | null }>`, `setLastSeenVersion(v: string): Promise<void>`.

`ipc.ts` Handlers + registrations mirror the three.

`preload/index.ts`: `appVersion: () => ipcRenderer.invoke(CH.appVersion) as Promise<string>,` etc.

`index.ts` handlers (near the existing settings handlers), import `selectReleaseNotes, type GithubRelease` from `'./version-notes.js'`:
```ts
    appVersion: async () => app.getVersion(),
    getWhatsNew: async () => {
      const version = app.getVersion()
      try {
        const res = await fetch('https://api.github.com/repos/darkharasho/axistream/releases?per_page=100', { headers: { Accept: 'application/vnd.github+json' } })
        if (!res.ok) return { version, notes: null }
        const raw = await res.json() as { tag_name?: string; body?: string }[]
        const releases: GithubRelease[] = raw.map((r) => ({ tag: String(r.tag_name ?? ''), body: String(r.body ?? '') }))
        return { version, notes: selectReleaseNotes(releases, version, settings.load().lastSeenVersion || null) }
      } catch { return { version, notes: null } }
    },
    setLastSeenVersion: async (v) => { settings.patch({ lastSeenVersion: v }) },
```

- [ ] **Step 4: Full gates + commit**

Focused, then FULL suite + FULL tsc (patch any flagged settings literal minimally).
```bash
git add packages/app/src/main/version-notes.ts packages/app/src/main/StreamSettings.ts packages/app/src/shared/state.ts packages/app/src/main/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/index.ts packages/app/test/
git commit -m "feat(updater): version-notes selector + app:version/getWhatsNew/setLastSeenVersion IPC"
```

---

### Task 3: Settings Updates section (check + progress + what's-new)

**Files:**
- Create: `packages/app/src/renderer/components/UpdatesSettings.tsx`
- Modify: `packages/app/src/renderer/components/SettingsScreen.tsx` (render it), `packages/app/src/renderer/styles.css`
- Test: `packages/app/test/updates-settings.test.tsx`

**Interfaces:**
- Consumes: `axi().appVersion/checkForUpdates/installUpdate/getWhatsNew/setLastSeenVersion`, `axi().onUpdateStatus`, `UpdateStatus` from `'../../shared/state.js'`.
- Produces: `UpdatesSettings` component (no props).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/test/updates-settings.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UpdatesSettings } from '../src/renderer/components/UpdatesSettings.js'

let statusCb: ((s: unknown) => void) | null = null
const axi = {
  appVersion: vi.fn(async () => '0.1.4'),
  checkForUpdates: vi.fn(async () => {}),
  installUpdate: vi.fn(async () => {}),
  getWhatsNew: vi.fn(async () => ({ version: '0.1.4', notes: null as string | null })),
  setLastSeenVersion: vi.fn(async () => {}),
  onUpdateStatus: vi.fn((cb: (s: unknown) => void) => { statusCb = cb; return () => {} }),
}
beforeEach(() => { (globalThis as any).axi = axi; vi.clearAllMocks(); statusCb = null })

describe('UpdatesSettings', () => {
  it('shows the current version and checks on click', async () => {
    render(<UpdatesSettings />)
    await waitFor(() => expect(screen.getByText(/0\.1\.4/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /check for updates/i }))
    expect(axi.checkForUpdates).toHaveBeenCalled()
  })

  it('renders the downloading percent and the Restart control when ready', async () => {
    render(<UpdatesSettings />)
    await waitFor(() => expect(statusCb).not.toBeNull())
    statusCb!({ state: 'downloading', percent: 42 })
    await waitFor(() => expect(screen.getByText(/42%/)).toBeInTheDocument())
    statusCb!({ state: 'ready', version: '0.1.5' })
    const restart = await screen.findByRole('button', { name: /restart/i })
    fireEvent.click(restart)
    expect(axi.installUpdate).toHaveBeenCalled()
  })

  it('surfaces an error status', async () => {
    render(<UpdatesSettings />)
    await waitFor(() => expect(statusCb).not.toBeNull())
    statusCb!({ state: 'error', message: 'A temporary network error interrupted the update check. Please try again.' })
    await waitFor(() => expect(screen.getByText(/temporary network error/i)).toBeInTheDocument())
  })

  it('shows What\'s new notes and dismisses them', async () => {
    axi.getWhatsNew.mockResolvedValueOnce({ version: '0.1.4', notes: '## v0.1.4\n\nSettable PTT hotkey' })
    render(<UpdatesSettings />)
    await waitFor(() => expect(screen.getByText(/settable ptt hotkey/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /got it/i }))
    expect(axi.setLastSeenVersion).toHaveBeenCalledWith('0.1.4')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm -w @axistream/app run test -- updates-settings`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement**

```tsx
// packages/app/src/renderer/components/UpdatesSettings.tsx
import { useEffect, useState } from 'react'
import type { AxiApi, UpdateStatus } from '../../shared/state.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi

export function UpdatesSettings() {
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [notes, setNotes] = useState<{ version: string; notes: string } | null>(null)

  useEffect(() => { axi().appVersion().then(setVersion) }, [])
  useEffect(() => axi().onUpdateStatus(setStatus), [])
  useEffect(() => { axi().getWhatsNew().then((w) => { if (w.notes) setNotes({ version: w.version, notes: w.notes }) }) }, [])

  const busy = status?.state === 'checking' || status?.state === 'downloading'
  const line = (): string => {
    switch (status?.state) {
      case 'checking': return 'Checking…'
      case 'downloading': return `Downloading ${status.percent}%`
      case 'available': return `Version ${status.version} available`
      case 'ready': return `Version ${status.version} ready`
      case 'none': return 'Up to date'
      case 'error': return status.message
      default: return ''
    }
  }

  return (
    <section className="yt-settings">
      <h3>Updates</h3>
      <p className="muted">AxiStream {version}</p>
      <div className="updates-row">
        <button className="btn ghost sm" disabled={busy} onClick={() => axi().checkForUpdates()}>Check for updates</button>
        {status?.state === 'ready' && <button className="btn primary sm" onClick={() => axi().installUpdate()}>Restart &amp; update</button>}
        {status && <span className={status.state === 'error' ? 'yt-test-err' : 'muted'}>{line()}</span>}
      </div>
      {notes && (
        <div className="whatsnew">
          <h4>What's new in {notes.version}</h4>
          <pre className="whatsnew-body">{notes.notes}</pre>
          <button className="btn ghost xs" onClick={() => { axi().setLastSeenVersion(notes.version); setNotes(null) }}>Got it</button>
        </div>
      )}
    </section>
  )
}
```
`SettingsScreen.tsx` — import and render `<UpdatesSettings />` in its own `<section className="setting">` (place it after the Audio section, before the Stream-key section).
`styles.css` — near the yt-settings styles:
```css
.updates-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.whatsnew { border-top: 1px solid rgba(255,255,255,.08); margin-top: 12px; padding-top: 10px; }
.whatsnew-body { white-space: pre-wrap; font-size: 12px; color: #c4cedb; background: #0b1017; border: 1px solid #1c242e; border-radius: 8px; padding: 10px; max-height: 220px; overflow: auto; }
```

- [ ] **Step 4: Full gates + commit**

Focused → FULL suite → FULL tsc.
```bash
git add packages/app/src/renderer/components/UpdatesSettings.tsx packages/app/src/renderer/components/SettingsScreen.tsx packages/app/src/renderer/styles.css packages/app/test/updates-settings.test.tsx
git commit -m "feat(updater): Settings Updates section — check, progress, what's-new"
```

---

## Self-Review

- **Spec coverage:** retry + friendly errors (T1) ✓; version-notes selector + app:version/getWhatsNew/setLastSeenVersion + lastSeenVersion setting (T2) ✓; Updates section with check/progress/Restart/what's-new (T3) ✓; sidebar pill + AppImage-ENOENT message preserved (T1 keeps the branch) ✓; not-ported items absent by omission ✓.
- **Type consistency:** `UpdateStatus` reused from state.ts across updater + UI; `GithubRelease` shared T2 producer/consumer; the three new IPC signatures identical across CH/AxiApi/Handlers/preload/UI; `getWhatsNew` return `{ version; notes: string | null }` uniform.
- **Placeholder scan:** none — full code in every step.
- **Gates:** every task mandates focused + FULL suite + FULL tsc.
