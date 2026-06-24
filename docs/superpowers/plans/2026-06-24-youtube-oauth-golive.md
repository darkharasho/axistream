# YouTube OAuth Go-Live + Title Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the pasted-stream-key go-live with a YouTube OAuth + Live Streaming API flow that creates and starts a real broadcast (with title templates and a privacy setting), while keeping the manual stream key as a fallback.

**Architecture:** The app owns the YouTube broadcast lifecycle at the main-process layer (`YouTubeAuth` for PKCE OAuth, `YouTubeLive` for the Live API). OBS stays on the auth-free `AxiStream` profile and only does a plain RTMPS push — `StreamController` is generalized to accept an ingest target plus lifecycle hooks so the YouTube broadcast is created/confirmed/completed around the existing OBS push+poll engine. A pure `TitleTemplate` engine resolves variables; `StreamSettings` persists the template, date format, privacy, and session counter.

**Tech Stack:** Electron 31, React 18, TypeScript 5.5, Vitest 2, obs-websocket-js 5, Node native `fetch` + `http` + `crypto` (no Google client library — REST calls direct).

## Global Constraints

- **No new heavy dependencies.** Use Node native `fetch`, `node:http`, `node:crypto`, Electron `safeStorage` and `shell.openExternal`. Do NOT add `googleapis`/`google-auth-library`. (Matches the project's minimal-dep style: capture's only runtime dep is `obs-websocket-js`.)
- **OBS must stay auth-free.** Never connect a YouTube account inside OBS. All broadcast management happens in `YouTubeLive`. The `ensureCleanProfile` behavior is preserved untouched.
- **Manual stream key remains a fallback** in both UI and main process — do not delete `KeyStore`, `KeyInput`, or the `saveKey`/`forgetKey` IPC.
- **Tests:** Vitest 2.0.0, fork pool max 2 (respect existing `vitest.config.ts`). App tests live in `packages/app/test/**/*.test.ts(x)`. Run with `npm -w @axistream/app run test`.
- **No linter is configured.** Match existing code style (2-space indent, no semicolons, single quotes, named exports, `.js` extensions on relative imports).
- **Module style:** relative imports use explicit `.js` extension (ESM/NodeNext), e.g. `import { x } from './pkce.js'`.
- **OAuth scope:** `https://www.googleapis.com/auth/youtube.force-ssl` (covers liveBroadcasts/liveStreams write + channels read).
- **userData files:** new persisted files live under `app.getPath('userData')`, matching `key.bin` / `capture.json`.

---

## Prerequisites (manual, one-time — not a code task)

These are done by a human in the Google Cloud Console before the OAuth flow can authenticate against a real account. Document them in the repo but they are not TDD steps.

1. Create a Google Cloud project.
2. Enable **YouTube Data API v3**.
3. Configure the OAuth consent screen (External), add scope `youtube.force-ssl`, add yourself as a **Test user** (until verification — unverified apps cap at ~100 users and show a warning).
4. Create an OAuth client of type **Desktop app**. Note the **client ID** and **client secret** (for Desktop clients the secret is embedded in the distributed app and is not treated as confidential; PKCE provides the real protection).
5. Provide them to the app at build/runtime via env vars `AXI_YT_CLIENT_ID` and `AXI_YT_CLIENT_SECRET` (Task 6 reads these).

Until this is done, run the app in **manual-key fallback mode** (unchanged from today).

---

## File Structure

**New (main process):**
- `packages/app/src/main/TitleTemplate.ts` — pure variable resolver
- `packages/app/src/main/StreamSettings.ts` — JSON settings store (template, date format, privacy, counter, reusable streamId)
- `packages/app/src/main/TokenStore.ts` — encrypted JSON OAuth token storage
- `packages/app/src/main/pkce.ts` — PKCE verifier/challenge + redirect helpers (pure)
- `packages/app/src/main/YouTubeLive.ts` — Live Streaming API REST wrapper
- `packages/app/src/main/YouTubeAuth.ts` — PKCE loopback OAuth + token refresh

**New (renderer):**
- `packages/app/src/renderer/components/YouTubeSettings.tsx` — connect/disconnect + template/format/privacy fields
- `packages/app/src/renderer/components/TitlePromptModal.tsx` — go-live title prompt

**New (tests):**
- `packages/app/test/title-template.test.ts`
- `packages/app/test/stream-settings.test.ts`
- `packages/app/test/token-store.test.ts`
- `packages/app/test/pkce.test.ts`
- `packages/app/test/youtube-live.test.ts`
- `packages/app/test/youtube-auth.test.ts`

**Modified:**
- `packages/app/src/main/StreamController.ts` — target + hooks
- `packages/app/test/stream-controller.test.ts` — updated for new signature
- `packages/app/src/shared/state.ts` — CH channels, AppState fields, settings/auth types
- `packages/app/src/main/ipc.ts` — new handlers
- `packages/app/src/preload/index.ts` — new api methods
- `packages/app/src/main/index.ts` — construct + wire everything, mode selection
- `packages/app/src/renderer/components/SettingsScreen.tsx` — mount `YouTubeSettings`
- `packages/app/src/renderer/components/StreamScreen.tsx` — title prompt on go-live

---

## Phase 1 — Pure foundations

### Task 1: TitleTemplate (pure resolver)

**Files:**
- Create: `packages/app/src/main/TitleTemplate.ts`
- Test: `packages/app/test/title-template.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type TemplateContext = { now: Date; counter: number; dateFormat: string }`
  - `function renderTitle(template: string, ctx: TemplateContext): string`
  - `function formatDate(d: Date, fmt: string): string` (supports tokens `YYYY`, `YY`, `MM`, `M`, `DD`, `D`)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { renderTitle, formatDate } from '../src/main/TitleTemplate.js'

const at = (iso: string) => new Date(iso)

describe('formatDate', () => {
  it('formats with M/D/YY and YYYY-MM-DD', () => {
    const d = at('2026-06-24T19:30:00')
    expect(formatDate(d, 'M/D/YY')).toBe('6/24/26')
    expect(formatDate(d, 'YYYY-MM-DD')).toBe('2026-06-24')
  })
})

describe('renderTitle', () => {
  const ctx = { now: at('2026-06-24T19:30:00'), counter: 42, dateFormat: 'YYYY-MM-DD' }

  it('resolves date, day, week, n', () => {
    expect(renderTitle('EWW Raid - {{date}}', ctx)).toBe('EWW Raid - 2026-06-24')
    expect(renderTitle('{{day}}', ctx)).toBe('Wednesday')
    expect(renderTitle('Week {{week}}', ctx)).toBe('Week 26')
    expect(renderTitle('Stream #{{n}}', ctx)).toBe('Stream #42')
  })

  it('resolves time', () => {
    expect(renderTitle('{{time}}', ctx)).toMatch(/^\d{1,2}:\d{2}/)
  })

  it('renders unknown variables as empty string', () => {
    expect(renderTitle('a {{bogus}} b', ctx)).toBe('a  b')
  })

  it('respects configured date format', () => {
    expect(renderTitle('{{date}}', { ...ctx, dateFormat: 'M/D/YY' })).toBe('6/24/26')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @axistream/app run test -- title-template`
Expected: FAIL — `renderTitle`/`formatDate` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
export interface TemplateContext {
  now: Date
  counter: number
  dateFormat: string
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function formatDate(d: Date, fmt: string): string {
  const yyyy = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return fmt
    .replace(/YYYY/g, String(yyyy))
    .replace(/YY/g, pad(yyyy % 100))
    .replace(/MM/g, pad(m))
    .replace(/M/g, String(m))
    .replace(/DD/g, pad(day))
    .replace(/D/g, String(day))
}

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const fDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fDayNum + 3)
  return 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000))
}

function formatTime(d: Date): string {
  let h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m} ${ampm}`
}

export function renderTitle(template: string, ctx: TemplateContext): string {
  const vars: Record<string, () => string> = {
    date: () => formatDate(ctx.now, ctx.dateFormat),
    time: () => formatTime(ctx.now),
    day: () => DAYS[ctx.now.getDay()],
    week: () => String(isoWeek(ctx.now)),
    n: () => String(ctx.counter),
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    const fn = vars[name]
    return fn ? fn() : ''
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @axistream/app run test -- title-template`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/TitleTemplate.ts packages/app/test/title-template.test.ts
git commit -m "feat(title): pure title-template resolver"
```

---

### Task 2: StreamSettings store

**Files:**
- Create: `packages/app/src/main/StreamSettings.ts`
- Test: `packages/app/test/stream-settings.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Privacy = 'public' | 'unlisted' | 'private'`
  - `interface StreamSettingsData { titleTemplate: string; dateFormat: string; privacy: Privacy; counter: number; streamId: string | null }`
  - `const DEFAULT_SETTINGS: StreamSettingsData`
  - `class StreamSettings { constructor(filePath: string); load(): StreamSettingsData; save(data: StreamSettingsData): void; patch(p: Partial<StreamSettingsData>): StreamSettingsData; bumpCounter(): number }`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StreamSettings, DEFAULT_SETTINGS } from '../src/main/StreamSettings.js'

let file: string
beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), 'axi-')), 'stream.json') })

describe('StreamSettings', () => {
  it('returns defaults when no file exists', () => {
    expect(new StreamSettings(file).load()).toEqual(DEFAULT_SETTINGS)
  })

  it('persists a patch and reloads it', () => {
    const s = new StreamSettings(file)
    s.patch({ titleTemplate: 'EWW Raid - {{date}}', privacy: 'unlisted' })
    const reloaded = new StreamSettings(file).load()
    expect(reloaded.titleTemplate).toBe('EWW Raid - {{date}}')
    expect(reloaded.privacy).toBe('unlisted')
  })

  it('bumpCounter increments and persists', () => {
    const s = new StreamSettings(file)
    expect(s.bumpCounter()).toBe(1)
    expect(s.bumpCounter()).toBe(2)
    expect(new StreamSettings(file).load().counter).toBe(2)
  })

  it('falls back to defaults on corrupt json', () => {
    const s = new StreamSettings(file)
    s.save({ ...DEFAULT_SETTINGS, privacy: 'private' })
    // simulate corruption
    require('node:fs').writeFileSync(file, '{not json')
    expect(new StreamSettings(file).load()).toEqual(DEFAULT_SETTINGS)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @axistream/app run test -- stream-settings`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type Privacy = 'public' | 'unlisted' | 'private'

export interface StreamSettingsData {
  titleTemplate: string
  dateFormat: string
  privacy: Privacy
  counter: number
  streamId: string | null
}

export const DEFAULT_SETTINGS: StreamSettingsData = {
  titleTemplate: '',
  dateFormat: 'YYYY-MM-DD',
  privacy: 'public',
  counter: 0,
  streamId: null,
}

const PRIVACIES: Privacy[] = ['public', 'unlisted', 'private']

export class StreamSettings {
  constructor(private readonly filePath: string) {}

  load(): StreamSettingsData {
    if (!existsSync(this.filePath)) return { ...DEFAULT_SETTINGS }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StreamSettingsData>
      return {
        titleTemplate: typeof raw.titleTemplate === 'string' ? raw.titleTemplate : DEFAULT_SETTINGS.titleTemplate,
        dateFormat: typeof raw.dateFormat === 'string' && raw.dateFormat ? raw.dateFormat : DEFAULT_SETTINGS.dateFormat,
        privacy: PRIVACIES.includes(raw.privacy as Privacy) ? (raw.privacy as Privacy) : DEFAULT_SETTINGS.privacy,
        counter: Number.isInteger(raw.counter) ? (raw.counter as number) : DEFAULT_SETTINGS.counter,
        streamId: typeof raw.streamId === 'string' ? raw.streamId : null,
      }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  save(data: StreamSettingsData): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(data, null, 2))
  }

  patch(p: Partial<StreamSettingsData>): StreamSettingsData {
    const next = { ...this.load(), ...p }
    this.save(next)
    return next
  }

  bumpCounter(): number {
    const next = this.load().counter + 1
    this.patch({ counter: next })
    return next
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @axistream/app run test -- stream-settings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/StreamSettings.ts packages/app/test/stream-settings.test.ts
git commit -m "feat(settings): persistent stream settings store"
```

---

### Task 3: TokenStore (encrypted JSON)

**Files:**
- Create: `packages/app/src/main/TokenStore.ts`
- Test: `packages/app/test/token-store.test.ts`

**Interfaces:**
- Consumes: `SafeStorageLike` (same shape as `KeyStore.ts` defines it; re-declare locally to avoid coupling).
- Produces:
  - `interface OAuthTokens { accessToken: string; refreshToken: string; expiresAt: number; channelTitle: string | null }`
  - `class TokenStore { constructor(filePath: string, safe: SafeStorageLike); canPersist(): boolean; save(t: OAuthTokens): void; load(): OAuthTokens | null; forget(): void }`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenStore } from '../src/main/TokenStore.js'

// Fake safeStorage: reversible XOR so we can prove no plaintext on disk.
const xor = (s: string) => Buffer.from([...Buffer.from(s, 'utf8')].map((b) => b ^ 0x5a))
const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => xor(s),
  decryptString: (b: Buffer) => xor(b.toString('utf8')).toString('utf8'),
}

let file: string
beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), 'axi-')), 'yt.bin') })

const sample = { accessToken: 'AT', refreshToken: 'RT', expiresAt: 1000, channelTitle: 'My Channel' }

describe('TokenStore', () => {
  it('round-trips tokens', () => {
    const s = new TokenStore(file, safe)
    s.save(sample)
    expect(new TokenStore(file, safe).load()).toEqual(sample)
  })

  it('does not write plaintext refresh token', () => {
    new TokenStore(file, safe).save(sample)
    expect(readFileSync(file, 'utf8')).not.toContain('RT')
  })

  it('returns null when missing', () => {
    expect(new TokenStore(file, safe).load()).toBeNull()
  })

  it('forget removes the file', () => {
    const s = new TokenStore(file, safe)
    s.save(sample)
    s.forget()
    expect(s.load()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @axistream/app run test -- token-store`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  channelTitle: string | null
}

export class TokenStore {
  constructor(private readonly filePath: string, private readonly safe: SafeStorageLike) {}

  canPersist(): boolean { return this.safe.isEncryptionAvailable() }

  save(t: OAuthTokens): void {
    if (!this.canPersist()) return
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, this.safe.encryptString(JSON.stringify(t)))
  }

  load(): OAuthTokens | null {
    if (!existsSync(this.filePath) || !this.canPersist()) return null
    try { return JSON.parse(this.safe.decryptString(readFileSync(this.filePath))) as OAuthTokens }
    catch { return null }
  }

  forget(): void { try { rmSync(this.filePath, { force: true }) } catch { /* ignore */ } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @axistream/app run test -- token-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/TokenStore.ts packages/app/test/token-store.test.ts
git commit -m "feat(auth): encrypted OAuth token store"
```

---

### Task 4: PKCE helper (pure)

**Files:**
- Create: `packages/app/src/main/pkce.ts`
- Test: `packages/app/test/pkce.test.ts`

**Interfaces:**
- Consumes: `node:crypto`.
- Produces:
  - `function base64url(buf: Buffer): string`
  - `function createPkce(): { verifier: string; challenge: string }` (challenge = base64url(sha256(verifier)))
  - `function randomState(): string`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { base64url, createPkce, randomState } from '../src/main/pkce.js'

describe('pkce', () => {
  it('challenge is base64url sha256 of verifier', () => {
    const { verifier, challenge } = createPkce()
    const expected = base64url(createHash('sha256').update(verifier).digest())
    expect(challenge).toBe(expected)
  })

  it('verifier is url-safe and long enough', () => {
    const { verifier } = createPkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
  })

  it('state is random and url-safe', () => {
    expect(randomState()).not.toBe(randomState())
    expect(randomState()).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @axistream/app run test -- pkce`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { createHash, randomBytes } from 'node:crypto'

export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32)) // 43 chars, url-safe
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export function randomState(): string {
  return base64url(randomBytes(16))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @axistream/app run test -- pkce`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/pkce.ts packages/app/test/pkce.test.ts
git commit -m "feat(auth): pkce + state helpers"
```

---

## Phase 2 — YouTube integration

### Task 5: YouTubeLive (Live Streaming API wrapper)

**Files:**
- Create: `packages/app/src/main/YouTubeLive.ts`
- Test: `packages/app/test/youtube-live.test.ts`

**Interfaces:**
- Consumes: an injected `accessToken()` provider and an injected `fetch` (default global `fetch`) for testability.
- Produces:
  - `interface Ingest { server: string; key: string }`
  - `interface LiveSession { broadcastId: string; streamId: string; ingest: Ingest }`
  - `interface YouTubeLiveDeps { accessToken(): Promise<string>; fetchFn?: typeof fetch }`
  - `class YouTubeLive`:
    - `channelTitle(): Promise<string | null>`
    - `startSession(opts: { title: string; privacy: Privacy; reuseStreamId: string | null; now: Date }): Promise<LiveSession>` (create broadcast with `enableAutoStart`/`enableAutoStop`, create-or-reuse stream, bind)
    - `confirmLive(broadcastId: string): Promise<boolean>` (true when `lifeCycleStatus === 'live'`)
    - `complete(broadcastId: string): Promise<void>` (best-effort transition to `complete`)

**Design notes (read before implementing):**
- Use REST: base `https://www.googleapis.com/youtube/v3`.
- Broadcast create body: `snippet:{ title, scheduledStartTime: now.toISOString() }`, `status:{ privacyStatus: privacy, selfDeclaredMadeForKids: false }`, `contentDetails:{ enableAutoStart: true, enableAutoStop: true, monitorStream:{ enableMonitorStream:false } }`. With `enableAutoStart`, YouTube transitions the broadcast to `live` automatically once ingestion is active — no manual `transition` needed in the happy path.
- Stream create body: `snippet:{ title:'AxiStream' }`, `cdn:{ ingestionType:'rtmp', frameRate:'variable', resolution:'variable' }`. Use the **RTMPS** ingestion: `cdn.ingestionInfo.rtmpsIngestionAddress` as `server` and `cdn.ingestionInfo.streamName` as `key`.
- Reuse: if `reuseStreamId` is set, GET that stream; if it 404s or is missing ingestion info, create a new one. `startSession` returns the (possibly new) `streamId` so the caller can persist it.
- All requests send `Authorization: Bearer <token>` and `Content-Type: application/json`; throw `Error` with status + body text on non-2xx.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { YouTubeLive } from '../src/main/YouTubeLive.js'

// Minimal fake fetch router keyed by method+path fragment.
function fakeFetch(routes: Record<string, any>) {
  const calls: { url: string; method: string; body: any }[] = []
  const fn = vi.fn(async (url: string, init?: any) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body) : undefined
    calls.push({ url, method, body })
    const key = Object.keys(routes).find((k) => `${method} `.startsWith(k.split(' ')[0] + ' ') && url.includes(k.split(' ')[1]))
    const payload = key ? routes[key] : { error: 'no route' }
    return { ok: !!key, status: key ? 200 : 404, json: async () => payload, text: async () => JSON.stringify(payload) }
  })
  return { fn, calls }
}

const token = async () => 'AT'

describe('YouTubeLive.startSession', () => {
  it('creates broadcast + stream, binds, returns rtmps ingest', async () => {
    const { fn, calls } = fakeFetch({
      'POST liveBroadcasts?': { id: 'B1' },
      'POST liveStreams?': { id: 'S1', cdn: { ingestionInfo: { rtmpsIngestionAddress: 'rtmps://x/live2', streamName: 'KEY' } } },
      'POST liveBroadcasts/bind': { id: 'B1' },
    })
    const yt = new YouTubeLive({ accessToken: token, fetchFn: fn as any })
    const s = await yt.startSession({ title: 'T', privacy: 'public', reuseStreamId: null, now: new Date('2026-06-24T00:00:00Z') })
    expect(s).toEqual({ broadcastId: 'B1', streamId: 'S1', ingest: { server: 'rtmps://x/live2', key: 'KEY' } })
    // broadcast created with enableAutoStart
    const created = calls.find((c) => c.url.includes('liveBroadcasts?') && c.method === 'POST')
    expect(created!.body.contentDetails.enableAutoStart).toBe(true)
    expect(created!.body.status.privacyStatus).toBe('public')
    // bind referenced both ids
    expect(calls.some((c) => c.url.includes('bind') && c.url.includes('id=B1') && c.url.includes('streamId=S1'))).toBe(true)
  })

  it('throws on non-2xx', async () => {
    const fn = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => 'quotaExceeded' }))
    const yt = new YouTubeLive({ accessToken: token, fetchFn: fn as any })
    await expect(yt.startSession({ title: 'T', privacy: 'public', reuseStreamId: null, now: new Date() }))
      .rejects.toThrow(/403/)
  })
})

describe('YouTubeLive.confirmLive', () => {
  it('true when lifeCycleStatus is live', async () => {
    const fn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [{ status: { lifeCycleStatus: 'live' } }] }), text: async () => '' }))
    const yt = new YouTubeLive({ accessToken: token, fetchFn: fn as any })
    expect(await yt.confirmLive('B1')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @axistream/app run test -- youtube-live`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Privacy } from './StreamSettings.js'

const BASE = 'https://www.googleapis.com/youtube/v3'

export interface Ingest { server: string; key: string }
export interface LiveSession { broadcastId: string; streamId: string; ingest: Ingest }

export interface YouTubeLiveDeps {
  accessToken(): Promise<string>
  fetchFn?: typeof fetch
}

export class YouTubeLive {
  private readonly f: typeof fetch
  constructor(private readonly d: YouTubeLiveDeps) {
    this.f = d.fetchFn ?? fetch
  }

  private async req(method: string, path: string, body?: unknown): Promise<any> {
    const token = await this.d.accessToken()
    const res = await this.f(`${BASE}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`YouTube API ${method} ${path} failed: ${res.status} ${await res.text()}`)
    return res.json()
  }

  async channelTitle(): Promise<string | null> {
    const r = await this.req('GET', 'channels?part=snippet&mine=true')
    return r.items?.[0]?.snippet?.title ?? null
  }

  private async ensureStream(reuseStreamId: string | null): Promise<{ streamId: string; ingest: Ingest }> {
    if (reuseStreamId) {
      try {
        const r = await this.req('GET', `liveStreams?part=cdn&id=${reuseStreamId}`)
        const info = r.items?.[0]?.cdn?.ingestionInfo
        if (info?.rtmpsIngestionAddress && info?.streamName) {
          return { streamId: reuseStreamId, ingest: { server: info.rtmpsIngestionAddress, key: info.streamName } }
        }
      } catch { /* fall through to create */ }
    }
    const created = await this.req('POST', 'liveStreams?part=snippet,cdn', {
      snippet: { title: 'AxiStream' },
      cdn: { ingestionType: 'rtmp', frameRate: 'variable', resolution: 'variable' },
    })
    const info = created.cdn.ingestionInfo
    return { streamId: created.id, ingest: { server: info.rtmpsIngestionAddress, key: info.streamName } }
  }

  async startSession(opts: { title: string; privacy: Privacy; reuseStreamId: string | null; now: Date }): Promise<LiveSession> {
    const broadcast = await this.req('POST', 'liveBroadcasts?part=snippet,status,contentDetails', {
      snippet: { title: opts.title, scheduledStartTime: opts.now.toISOString() },
      status: { privacyStatus: opts.privacy, selfDeclaredMadeForKids: false },
      contentDetails: { enableAutoStart: true, enableAutoStop: true, monitorStream: { enableMonitorStream: false } },
    })
    const { streamId, ingest } = await this.ensureStream(opts.reuseStreamId)
    await this.req('POST', `liveBroadcasts/bind?id=${broadcast.id}&streamId=${streamId}&part=id,contentDetails`)
    return { broadcastId: broadcast.id, streamId, ingest }
  }

  async confirmLive(broadcastId: string): Promise<boolean> {
    const r = await this.req('GET', `liveBroadcasts?part=status&id=${broadcastId}`)
    return r.items?.[0]?.status?.lifeCycleStatus === 'live'
  }

  async complete(broadcastId: string): Promise<void> {
    try { await this.req('POST', `liveBroadcasts/transition?broadcastStatus=complete&id=${broadcastId}&part=status`) }
    catch { /* best-effort cleanup */ }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @axistream/app run test -- youtube-live`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/YouTubeLive.ts packages/app/test/youtube-live.test.ts
git commit -m "feat(youtube): live streaming api wrapper"
```

---

### Task 6: YouTubeAuth (PKCE loopback OAuth + refresh)

**Files:**
- Create: `packages/app/src/main/YouTubeAuth.ts`
- Test: `packages/app/test/youtube-auth.test.ts`

**Interfaces:**
- Consumes: `TokenStore`, `createPkce`/`randomState` from `pkce.js`, injected `fetch`, injected `openExternal(url)`, injected `listen()` (loopback listener abstraction so tests don't bind sockets).
- Produces:
  - `interface AuthConfig { clientId: string; clientSecret: string }`
  - `interface LoopbackResult { redirectUri: string; waitForCode(): Promise<{ code: string; state: string }>; close(): void }`
  - `interface YouTubeAuthDeps { store: TokenStore; config: AuthConfig; fetchFn?: typeof fetch; openExternal(url: string): Promise<void>; listen(): Promise<LoopbackResult> }`
  - `class YouTubeAuth`:
    - `isConnected(): boolean`
    - `channelTitle(): string | null`
    - `connect(): Promise<void>` (full PKCE flow; persists tokens; fetches channel title via a passed callback is NOT done here — caller sets channelTitle when saving; see note)
    - `disconnect(): void`
    - `accessToken(): Promise<string>` (returns a valid token, refreshing if `expiresAt` within 60s; throws if not connected / refresh fails)

**Design notes:**
- `connect()`: `const { verifier, challenge } = createPkce()`; `const state = randomState()`; `const lb = await listen()`; build auth URL to `https://accounts.google.com/o/oauth2/v2/auth` with `client_id, redirect_uri=lb.redirectUri, response_type=code, scope, code_challenge=challenge, code_challenge_method=S256, state, access_type=offline, prompt=consent`; `await openExternal(authUrl)`; `const { code, state: returned } = await lb.waitForCode()`; verify `returned === state` (throw on mismatch); exchange code at `https://oauth2.googleapis.com/token` (POST form-encoded: `client_id, client_secret, code, code_verifier=verifier, grant_type=authorization_code, redirect_uri`); store tokens with `expiresAt = Date.now() + expires_in*1000`. `lb.close()` in a `finally`.
- `accessToken()`: load tokens; if `Date.now() >= expiresAt - 60_000`, refresh via `grant_type=refresh_token`; persist refreshed access token + new expiry (keep existing refresh token if the response omits one); return access token.
- The real loopback `listen()` (used by `index.ts`, not under unit test) creates a `node:http` server on `127.0.0.1:0`, resolves `redirectUri = http://127.0.0.1:<port>/callback`, and `waitForCode()` resolves from the first request's query params then responds with a small "You can close this window" HTML page. This concrete listener is provided in Task 10's wiring, not here, so it can be swapped with a fake in tests.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenStore } from '../src/main/TokenStore.js'
import { YouTubeAuth } from '../src/main/YouTubeAuth.js'

const safe = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString('utf8') }

function fakeListen(code: string, stateBack: (s: string) => string) {
  return async () => {
    let capturedState = ''
    return {
      redirectUri: 'http://127.0.0.1:9999/callback',
      // The auth URL build happens before waitForCode; we capture state from openExternal instead.
      waitForCode: async () => ({ code, state: capturedState }),
      close: () => {},
      _setState: (s: string) => { capturedState = stateBack(s) },
    } as any
  }
}

let store: TokenStore
beforeEach(() => { store = new TokenStore(join(mkdtempSync(join(tmpdir(), 'axi-')), 'yt.bin'), safe) })

describe('YouTubeAuth.connect', () => {
  it('runs PKCE, exchanges code, persists tokens', async () => {
    let openedUrl = ''
    const lb: any = {
      redirectUri: 'http://127.0.0.1:9999/callback',
      waitForCode: async () => {
        const u = new URL(openedUrl)
        return { code: 'CODE', state: u.searchParams.get('state')! }
      },
      close: vi.fn(),
    }
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }), text: async () => '' })) as any
    const auth = new YouTubeAuth({
      store,
      config: { clientId: 'cid', clientSecret: 'sec' },
      fetchFn,
      openExternal: async (url: string) => { openedUrl = url },
      listen: async () => lb,
    })
    await auth.connect()
    expect(auth.isConnected()).toBe(true)
    expect(store.load()!.refreshToken).toBe('RT')
    // PKCE params present in auth url
    const u = new URL(openedUrl)
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('code_challenge')).toBeTruthy()
  })
})

describe('YouTubeAuth.accessToken', () => {
  it('refreshes when expired', async () => {
    store.save({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: 0, channelTitle: null })
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'NEW', expires_in: 3600 }), text: async () => '' })) as any
    const auth = new YouTubeAuth({ store, config: { clientId: 'cid', clientSecret: 'sec' }, fetchFn, openExternal: async () => {}, listen: async () => ({} as any) })
    expect(await auth.accessToken()).toBe('NEW')
    expect(store.load()!.refreshToken).toBe('RT') // preserved
  })

  it('returns cached token when still valid', async () => {
    store.save({ accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3_600_000, channelTitle: null })
    const fetchFn = vi.fn() as any
    const auth = new YouTubeAuth({ store, config: { clientId: 'cid', clientSecret: 'sec' }, fetchFn, openExternal: async () => {}, listen: async () => ({} as any) })
    expect(await auth.accessToken()).toBe('AT')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('throws when not connected', async () => {
    const auth = new YouTubeAuth({ store, config: { clientId: 'cid', clientSecret: 'sec' }, fetchFn: vi.fn() as any, openExternal: async () => {}, listen: async () => ({} as any) })
    await expect(auth.accessToken()).rejects.toThrow(/not connected/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @axistream/app run test -- youtube-auth`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { TokenStore, type OAuthTokens } from './TokenStore.js'
import { createPkce, randomState } from './pkce.js'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl'

export interface AuthConfig { clientId: string; clientSecret: string }

export interface LoopbackResult {
  redirectUri: string
  waitForCode(): Promise<{ code: string; state: string }>
  close(): void
}

export interface YouTubeAuthDeps {
  store: TokenStore
  config: AuthConfig
  fetchFn?: typeof fetch
  openExternal(url: string): Promise<void>
  listen(): Promise<LoopbackResult>
}

export class YouTubeAuth {
  private readonly f: typeof fetch
  constructor(private readonly d: YouTubeAuthDeps) { this.f = d.fetchFn ?? fetch }

  isConnected(): boolean { return this.d.store.load() !== null }
  channelTitle(): string | null { return this.d.store.load()?.channelTitle ?? null }
  disconnect(): void { this.d.store.forget() }

  async connect(): Promise<void> {
    const { verifier, challenge } = createPkce()
    const state = randomState()
    const lb = await this.d.listen()
    try {
      const url = new URL(AUTH_URL)
      url.search = new URLSearchParams({
        client_id: this.d.config.clientId,
        redirect_uri: lb.redirectUri,
        response_type: 'code',
        scope: SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent',
      }).toString()
      await this.d.openExternal(url.toString())
      const got = await lb.waitForCode()
      if (got.state !== state) throw new Error('OAuth state mismatch')
      const tok = await this.exchange({
        grant_type: 'authorization_code',
        code: got.code,
        code_verifier: verifier,
        redirect_uri: lb.redirectUri,
      })
      this.d.store.save({
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        expiresAt: Date.now() + tok.expires_in * 1000,
        channelTitle: null,
      })
    } finally {
      lb.close()
    }
  }

  async accessToken(): Promise<string> {
    const t = this.d.store.load()
    if (!t) throw new Error('YouTube not connected')
    if (Date.now() < t.expiresAt - 60_000) return t.accessToken
    const tok = await this.exchange({ grant_type: 'refresh_token', refresh_token: t.refreshToken })
    const next: OAuthTokens = {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? t.refreshToken,
      expiresAt: Date.now() + tok.expires_in * 1000,
      channelTitle: t.channelTitle,
    }
    this.d.store.save(next)
    return next.accessToken
  }

  setChannelTitle(title: string | null): void {
    const t = this.d.store.load()
    if (t) this.d.store.save({ ...t, channelTitle: title })
  }

  private async exchange(extra: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
    const body = new URLSearchParams({
      client_id: this.d.config.clientId,
      client_secret: this.d.config.clientSecret,
      ...extra,
    })
    const res = await this.f(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) throw new Error(`OAuth token exchange failed: ${res.status} ${await res.text()}`)
    return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number }>
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @axistream/app run test -- youtube-auth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/YouTubeAuth.ts packages/app/test/youtube-auth.test.ts
git commit -m "feat(auth): pkce loopback oauth with refresh"
```

---

## Phase 3 — StreamController refactor

### Task 7: StreamController — ingest target + lifecycle hooks

**Files:**
- Modify: `packages/app/src/main/StreamController.ts`
- Modify: `packages/app/test/stream-controller.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (new signature):
  - `interface Ingest { server: string; key: string }`
  - `interface GoLiveHooks { onIngestActive?: () => Promise<void>; onStop?: () => Promise<void> }`
  - `goLive(target: Ingest, hooks?: GoLiveHooks): Promise<void>`
  - `stop()` unchanged externally (now also awaits `hooks.onStop`).

**Behavior changes:**
- `goLive` takes `{ server, key }` (was a bare `key` + hardcoded `YT_RTMPS`). Caller now supplies the server.
- When the poll first sees `outputActive` true, await `hooks.onIngestActive?.()` **before** flipping to `LIVE`. If it throws, run `failStart` (which calls `hooks.onStop`).
- `failStart` and `stop` both await `hooks.onStop?.()` (best-effort, wrapped in try/catch) so the broadcast is completed/cleaned up.

- [ ] **Step 1: Update the existing tests to the new signature + add hook tests**

Replace the body of `packages/app/test/stream-controller.test.ts` with:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { StreamController } from '../src/main/StreamController.js'

function clientFrom(statuses: any[]) {
  let i = 0
  const calls: string[] = []
  return {
    calls,
    client: () => ({
      call: vi.fn(async (req: string) => {
        calls.push(req)
        if (req === 'GetStreamStatus') return statuses[Math.min(i++, statuses.length - 1)]
        return {}
      }),
    }),
  }
}

const ingest = { server: 'rtmps://x/live2', key: 'KEY' }

describe('StreamController', () => {
  it('goLive sets service from target, starts, reaches LIVE', async () => {
    const c = clientFrom([{ outputActive: true, outputReconnecting: false, outputBytes: 1 }])
    const phases: string[] = []
    const sc = new StreamController({ client: c.client, onPhase: (p) => phases.push(p), onStats: () => {}, pollMs: 5 })
    await sc.goLive(ingest)
    await new Promise((r) => setTimeout(r, 30))
    expect(c.calls).toContain('SetStreamServiceSettings')
    expect(c.calls).toContain('StartStream')
    expect(phases).toContain('LIVE')
  })

  it('awaits onIngestActive before declaring LIVE, and onStop on stop', async () => {
    const c = clientFrom([{ outputActive: true, outputReconnecting: false, outputBytes: 1 }])
    const order: string[] = []
    const sc = new StreamController({ client: c.client, onPhase: (p) => order.push(`phase:${p}`), onStats: () => {}, pollMs: 5 })
    await sc.goLive(ingest, {
      onIngestActive: async () => { order.push('activate') },
      onStop: async () => { order.push('stop') },
    })
    await new Promise((r) => setTimeout(r, 30))
    expect(order.indexOf('activate')).toBeLessThan(order.indexOf('phase:LIVE'))
    await sc.stop()
    expect(order).toContain('stop')
  })

  it('emits ERROR, stops, and runs onStop if never active before timeout', async () => {
    const c = clientFrom([{ outputActive: false, outputReconnecting: false, outputBytes: 0 }])
    const phases: string[] = []
    let cleaned = false
    const sc = new StreamController({ client: c.client, onPhase: (p) => phases.push(p), onStats: () => {}, pollMs: 5, goLiveTimeoutMs: 20 })
    await sc.goLive(ingest, { onStop: async () => { cleaned = true } })
    await new Promise((r) => setTimeout(r, 90))
    expect(phases).toContain('ERROR')
    expect(cleaned).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w @axistream/app run test -- stream-controller`
Expected: FAIL — `goLive` still expects a string / no hooks support.

- [ ] **Step 3: Update `StreamController.ts`**

Apply these changes (keep the rest of the file — stats mapping, `clear`, polling skeleton — intact):

```typescript
// Remove: const YT_RTMPS = 'rtmps://a.rtmps.youtube.com/live2'  (server now comes from caller)

export interface Ingest { server: string; key: string }
export interface GoLiveHooks {
  onIngestActive?: () => Promise<void>
  onStop?: () => Promise<void>
}

// inside the class:
private hooks: GoLiveHooks = {}

async goLive(target: Ingest, hooks: GoLiveHooks = {}): Promise<void> {
  if (this.live || this.timer) return
  this.hooks = hooks
  const c = this.d.client()
  await callReady(() => c.call('SetStreamServiceSettings', {
    streamServiceType: 'rtmp_custom',
    streamServiceSettings: { server: target.server, key: target.key },
  }))
  await callReady(() => c.call('StartStream'))
  this.d.onPhase('GOING_LIVE')

  const pollMs = this.d.pollMs ?? 1000
  const deadline = (this.d.goLiveTimeoutMs ?? 15000) / pollMs
  let ticks = 0
  let becameLive = false
  this.timer = setInterval(async () => {
    ticks++
    let st: any
    try { st = await c.call('GetStreamStatus') } catch { return }
    if (!st.outputActive && !becameLive) {
      if (ticks >= deadline) await this.failStart(c)
      return
    }
    if (st.outputActive && !becameLive) {
      becameLive = true
      try { await this.hooks.onIngestActive?.() }
      catch { await this.failStart(c); return }
      this.live = true
      this.d.onPhase('LIVE')
    }
    this.d.onPhase(st.outputReconnecting ? 'RECONNECTING' : 'LIVE')
    this.d.onStats(this.mapStats(st, pollMs))
  }, pollMs)
}

private async failStart(c: { call(r: string): Promise<any> }): Promise<void> {
  this.clear()
  try { await c.call('StopStream') } catch { /* ignore */ }
  try { await this.hooks.onStop?.() } catch { /* ignore */ }
  this.live = false
  this.d.onPhase('ERROR', "Couldn't start stream — check your key and connection.")
}

async stop(): Promise<void> {
  this.clear()
  try { await this.d.client().call('StopStream') } catch { /* ignore */ }
  try { await this.hooks.onStop?.() } catch { /* ignore */ }
  this.live = false
  this.d.onPhase('READY')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w @axistream/app run test -- stream-controller`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/StreamController.ts packages/app/test/stream-controller.test.ts
git commit -m "refactor(stream): accept ingest target + go-live hooks"
```

---

## Phase 4 — Wiring (state, IPC, preload, main)

### Task 8: Shared state, channels, and types

**Files:**
- Modify: `packages/app/src/shared/state.ts`

**Interfaces:**
- Produces:
  - `StreamPhase` gains `'NEEDS_TITLE'` (used when OAuth go-live is requested with no template and no override).
  - `AppState` gains: `youtube: { connected: boolean; channel: string | null }` and `settings: StreamSettingsView`.
  - `interface StreamSettingsView { titleTemplate: string; dateFormat: string; privacy: 'public' | 'unlisted' | 'private' }` (counter/streamId are main-only; not exposed).
  - `CH` gains: `connectYouTube`, `disconnectYouTube`, `getSettings`, `saveSettings`, `previewTitle`.

- [ ] **Step 1: Add channels and state fields**

In `packages/app/src/shared/state.ts`:

```typescript
export type StreamPhase =
  | 'SETTING_UP' | 'AWAITING_APPROVAL' | 'NEEDS_KEY' | 'NEEDS_TITLE' | 'READY'
  | 'GOING_LIVE' | 'LIVE' | 'RECONNECTING' | 'ERROR'

export interface StreamSettingsView {
  titleTemplate: string
  dateFormat: string
  privacy: 'public' | 'unlisted' | 'private'
}

export interface AppState {
  phase: StreamPhase
  capture: CaptureMeta | null
  keyMasked: string | null
  stats: LiveStats | null
  error: string | null
  youtube: { connected: boolean; channel: string | null }
  settings: StreamSettingsView
}

export const INITIAL_STATE: AppState = {
  phase: 'SETTING_UP', capture: null, keyMasked: null, stats: null, error: null,
  youtube: { connected: false, channel: null },
  settings: { titleTemplate: '', dateFormat: 'YYYY-MM-DD', privacy: 'public' },
}

export const CH = {
  // ...existing channels unchanged...
  connectYouTube: 'axi:connectYouTube',
  disconnectYouTube: 'axi:disconnectYouTube',
  getSettings: 'axi:getSettings',
  saveSettings: 'axi:saveSettings',
  previewTitle: 'axi:previewTitle',
}
```

- [ ] **Step 2: Typecheck**

Run: `npm -w @axistream/app run build`
Expected: type errors ONLY in files that consume `AppState`/`CH` (ipc.ts, preload, index.ts, renderer) — those are fixed in Tasks 9–12. The `state.ts` file itself compiles.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/shared/state.ts
git commit -m "feat(state): youtube + settings fields and channels"
```

> Note: build is not fully green until Task 10. That is expected; later tasks close the gap. Do not "fix" consumers here.

---

### Task 9: IPC handlers + preload API

**Files:**
- Modify: `packages/app/src/main/ipc.ts`
- Modify: `packages/app/src/preload/index.ts`

**Interfaces:**
- Consumes: `CH` additions from Task 8.
- Produces (added to `IpcHandlers`):
  - `connectYouTube(): Promise<void>`
  - `disconnectYouTube(): Promise<void>`
  - `getSettings(): Promise<StreamSettingsView>`
  - `saveSettings(p: Partial<StreamSettingsView>): Promise<StreamSettingsView>`
  - `previewTitle(template: string): Promise<string>`
  - `goLive(titleOverride?: string)` — signature widened.
- Produces (added to `AxiApi` in preload): matching methods.

- [ ] **Step 1: Extend `IpcHandlers` and registration in `ipc.ts`**

Add to the `IpcHandlers` interface and `registerIpc`:

```typescript
// interface IpcHandlers — add:
connectYouTube(): Promise<void>
disconnectYouTube(): Promise<void>
getSettings(): Promise<StreamSettingsView>
saveSettings(p: Partial<StreamSettingsView>): Promise<StreamSettingsView>
previewTitle(template: string): Promise<string>
// and widen:
goLive(titleOverride?: string): Promise<void>

// inside registerIpc — add:
ipcMain.handle(CH.connectYouTube, () => handlers.connectYouTube())
ipcMain.handle(CH.disconnectYouTube, () => handlers.disconnectYouTube())
ipcMain.handle(CH.getSettings, () => handlers.getSettings())
ipcMain.handle(CH.saveSettings, (_e: unknown, p: StreamSettingsView) => handlers.saveSettings(p))
ipcMain.handle(CH.previewTitle, (_e: unknown, t: string) => handlers.previewTitle(t))
// change existing goLive registration to forward the optional title:
ipcMain.handle(CH.goLive, (_e: unknown, title?: string) => handlers.goLive(title))
```

(Import `StreamSettingsView` from `../shared/state.js`.)

- [ ] **Step 2: Extend `AxiApi` + preload bridge in `preload/index.ts`**

```typescript
// in the AxiApi type:
connectYouTube: () => Promise<void>
disconnectYouTube: () => Promise<void>
getSettings: () => Promise<StreamSettingsView>
saveSettings: (p: Partial<StreamSettingsView>) => Promise<StreamSettingsView>
previewTitle: (template: string) => Promise<string>
goLive: (title?: string) => Promise<void>

// in the api object:
connectYouTube: () => ipcRenderer.invoke(CH.connectYouTube) as Promise<void>,
disconnectYouTube: () => ipcRenderer.invoke(CH.disconnectYouTube) as Promise<void>,
getSettings: () => ipcRenderer.invoke(CH.getSettings) as Promise<StreamSettingsView>,
saveSettings: (p) => ipcRenderer.invoke(CH.saveSettings, p) as Promise<StreamSettingsView>,
previewTitle: (t) => ipcRenderer.invoke(CH.previewTitle, t) as Promise<string>,
goLive: (title) => ipcRenderer.invoke(CH.goLive, title) as Promise<void>,
```

- [ ] **Step 3: Typecheck (expect only index.ts gaps)**

Run: `npm -w @axistream/app run build`
Expected: remaining type errors confined to `index.ts` (handlers object not yet implementing new methods) — fixed in Task 10.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main/ipc.ts packages/app/src/preload/index.ts
git commit -m "feat(ipc): youtube + settings + title-preview channels"
```

---

### Task 10: Main process wiring + loopback listener

**Files:**
- Modify: `packages/app/src/main/index.ts`
- Create: `packages/app/src/main/loopback.ts` (concrete `listen()` for OAuth redirect)
- Test: `packages/app/test/loopback.test.ts`

**Interfaces:**
- Consumes: `YouTubeAuth`, `YouTubeLive`, `StreamSettings`, `TokenStore`, `TitleTemplate.renderTitle`, `StreamController` (new signature).
- Produces: `function createLoopback(): Promise<LoopbackResult>` in `loopback.ts`.

**Wiring behavior (the heart of the feature):**
- Construct: `const tokenStore = new TokenStore(join(userData,'yt-tokens.bin'), safeStorage)`; `const settings = new StreamSettings(join(userData,'stream.json'))`; `const auth = new YouTubeAuth({ store: tokenStore, config: { clientId: process.env.AXI_YT_CLIENT_ID ?? '', clientSecret: process.env.AXI_YT_CLIENT_SECRET ?? '' }, openExternal: (u) => shell.openExternal(u), listen: createLoopback })`; `const live = new YouTubeLive({ accessToken: () => auth.accessToken() })`.
- `getInitialState`: include `youtube: { connected: auth.isConnected(), channel: auth.channelTitle() }` and `settings: viewOf(settings.load())`.
- `connectYouTube`: `await auth.connect()`; then `const title = await live.channelTitle().catch(() => null)`; `auth.setChannelTitle(title)`; `setState({ youtube: { connected: true, channel: title } })`.
- `disconnectYouTube`: `auth.disconnect()`; `setState({ youtube: { connected: false, channel: null } })`.
- `getSettings` / `saveSettings`: read/patch `settings`, return the view; on save also `setState({ settings: view })`.
- `previewTitle(template)`: `renderTitle(template, { now: new Date(), counter: settings.load().counter + 1, dateFormat: settings.load().dateFormat })`.
- `goLive(titleOverride?)`:
  - **Manual mode** (auth not connected): require a saved key (existing `NEEDS_KEY` guard); `await stream.goLive({ server: YT_RTMPS, key })` with no hooks. (Keep a local `const YT_RTMPS = 'rtmps://a.rtmps.youtube.com/live2'` here since it moved out of StreamController.)
  - **OAuth mode** (auth connected):
    - Resolve title: `const s = settings.load(); const tpl = s.titleTemplate.trim(); const title = (titleOverride && titleOverride.trim()) || (tpl && renderTitle(tpl, { now: new Date(), counter: s.counter + 1, dateFormat: s.dateFormat }))`.
    - If no title → `setState({ phase: 'NEEDS_TITLE' })` and return (renderer prompts, then calls `goLive(title)`).
    - `setState({ phase: 'GOING_LIVE' })`.
    - `const session = await live.startSession({ title, privacy: s.privacy, reuseStreamId: s.streamId, now: new Date() })`.
    - Persist reusable stream: `settings.patch({ streamId: session.streamId })`.
    - `await stream.goLive(session.ingest, { onIngestActive: async () => { /* enableAutoStart handles transition; confirm best-effort */ try { await live.confirmLive(session.broadcastId) } catch {} }, onStop: () => live.complete(session.broadcastId) })`.
    - On successful LIVE (first time), bump the counter: subscribe via the existing `onPhase` — when phase becomes `LIVE` and we are in OAuth mode for this session, call `settings.bumpCounter()` once. Implement with a one-shot flag set in this handler and checked in the `onPhase` callback.
  - Wrap the OAuth path in try/catch → on error `setState({ phase: 'ERROR', error: humanMessage })` and best-effort `live.complete` if a broadcast was created.

- [ ] **Step 1: Write the failing test for the loopback listener**

```typescript
import { describe, it, expect } from 'vitest'
import { createLoopback } from '../src/main/loopback.js'

describe('createLoopback', () => {
  it('captures code+state from the redirect request', async () => {
    const lb = await createLoopback()
    expect(lb.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    const codePromise = lb.waitForCode()
    // hit the loopback as the browser would
    await fetch(`${lb.redirectUri}?code=ABC&state=XYZ`)
    const got = await codePromise
    expect(got).toEqual({ code: 'ABC', state: 'XYZ' })
    lb.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @axistream/app run test -- loopback`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `loopback.ts`**

```typescript
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { LoopbackResult } from './YouTubeAuth.js'

const DONE_HTML = '<!doctype html><meta charset="utf-8"><title>AxiStream</title><body style="font-family:sans-serif;padding:2rem">You can close this window and return to AxiStream.</body>'

export function createLoopback(): Promise<LoopbackResult> {
  return new Promise((resolve) => {
    let onCode: (v: { code: string; state: string }) => void = () => {}
    const codePromise = new Promise<{ code: string; state: string }>((r) => { onCode = r })
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/callback') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(DONE_HTML)
        onCode({ code: url.searchParams.get('code') ?? '', state: url.searchParams.get('state') ?? '' })
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      resolve({
        redirectUri: `http://127.0.0.1:${port}/callback`,
        waitForCode: () => codePromise,
        close: () => server.close(),
      })
    })
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @axistream/app run test -- loopback`
Expected: PASS.

- [ ] **Step 5: Wire everything in `index.ts`**

Implement the construction and the handler bodies exactly as described in "Wiring behavior" above. Add the `viewOf` helper:

```typescript
import { StreamSettings, type StreamSettingsData } from './StreamSettings.js'
import { TokenStore } from './TokenStore.js'
import { YouTubeAuth } from './YouTubeAuth.js'
import { YouTubeLive } from './YouTubeLive.js'
import { renderTitle } from './TitleTemplate.js'
import { createLoopback } from './loopback.js'
import { shell } from 'electron'
import type { StreamSettingsView } from '../shared/state.js'

const YT_RTMPS = 'rtmps://a.rtmps.youtube.com/live2'
const viewOf = (s: StreamSettingsData): StreamSettingsView => ({ titleTemplate: s.titleTemplate, dateFormat: s.dateFormat, privacy: s.privacy })
```

Implement the `goLive` one-shot counter bump: keep `let pendingOAuthBump = false` in the handler scope; set it true right before `stream.goLive(...)` in OAuth mode; in the `onPhase` wiring where `setState` runs, when the incoming phase is `'LIVE'` and `pendingOAuthBump`, call `settings.bumpCounter()` and set the flag false.

- [ ] **Step 6: Full typecheck/build is green**

Run: `npm -w @axistream/app run build`
Expected: SUCCESS, no type errors across the package.

- [ ] **Step 7: Full test suite green**

Run: `npm -w @axistream/app run test`
Expected: PASS (all suites).

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/main/index.ts packages/app/src/main/loopback.ts packages/app/test/loopback.test.ts
git commit -m "feat(main): wire oauth go-live, settings, loopback listener"
```

---

## Phase 5 — Renderer UI

### Task 11: YouTube settings UI

**Files:**
- Create: `packages/app/src/renderer/components/YouTubeSettings.tsx`
- Modify: `packages/app/src/renderer/components/SettingsScreen.tsx`
- Modify: `packages/app/src/renderer/styles.css` (add minimal classes used below)

**Interfaces:**
- Consumes: `axi.connectYouTube`, `axi.disconnectYouTube`, `axi.getSettings`, `axi.saveSettings`, `axi.previewTitle`, and `state.youtube` from the store.
- Produces: a `<YouTubeSettings>` component mounted inside `SettingsScreen`.

**Behavior:**
- Shows connection status from `state.youtube`: if `connected`, show channel name + "Disconnect"; else show "Connect YouTube account (recommended)" button that calls `axi.connectYouTube()`.
- Title template text input bound to settings; on change debounce-saves via `axi.saveSettings({ titleTemplate })` and updates a **live preview** via `axi.previewTitle(template)`.
- Date format input (default `YYYY-MM-DD`), saved via `axi.saveSettings({ dateFormat })`.
- Privacy `<select>` (public/unlisted/private), saved via `axi.saveSettings({ privacy })`.
- Help line listing variables: `{{date}} {{time}} {{day}} {{week}} {{n}}`.
- Keep the existing manual `KeyInput`/masked-key UI in `SettingsScreen` below this, labeled "Stream key (advanced fallback)".

- [ ] **Step 1: Write a render test**

`packages/app/test/youtube-settings.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { YouTubeSettings } from '../src/renderer/components/YouTubeSettings.js'

const axi = {
  connectYouTube: vi.fn(async () => {}),
  disconnectYouTube: vi.fn(async () => {}),
  getSettings: vi.fn(async () => ({ titleTemplate: 'EWW - {{date}}', dateFormat: 'YYYY-MM-DD', privacy: 'public' as const })),
  saveSettings: vi.fn(async (p: any) => ({ titleTemplate: 'EWW - {{date}}', dateFormat: 'YYYY-MM-DD', privacy: 'public' as const, ...p })),
  previewTitle: vi.fn(async () => 'EWW - 2026-06-24'),
}
beforeEach(() => { (globalThis as any).axi = axi; vi.clearAllMocks() })

describe('YouTubeSettings', () => {
  it('shows Connect when disconnected and connects on click', async () => {
    render(<YouTubeSettings youtube={{ connected: false, channel: null }} />)
    fireEvent.click(screen.getByRole('button', { name: /connect youtube/i }))
    await waitFor(() => expect(axi.connectYouTube).toHaveBeenCalled())
  })

  it('shows channel + live title preview when connected', async () => {
    render(<YouTubeSettings youtube={{ connected: true, channel: 'My Channel' }} />)
    expect(screen.getByText(/my channel/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('EWW - 2026-06-24')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @axistream/app run test -- youtube-settings`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `YouTubeSettings.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { AxiApi } from '../../preload/index.js'
import type { StreamSettingsView } from '../../shared/state.js'

const axi = () => (globalThis as { axi: AxiApi }).axi
const VARS = '{{date}} · {{time}} · {{day}} · {{week}} · {{n}}'

export function YouTubeSettings({ youtube }: { youtube: { connected: boolean; channel: string | null } }) {
  const [s, setS] = useState<StreamSettingsView | null>(null)
  const [preview, setPreview] = useState('')

  useEffect(() => { axi().getSettings().then(setS) }, [])
  useEffect(() => {
    if (!s) return
    const id = setTimeout(() => { axi().previewTitle(s.titleTemplate).then(setPreview) }, 200)
    return () => clearTimeout(id)
  }, [s?.titleTemplate, s?.dateFormat])

  if (!s) return null
  const update = (p: Partial<StreamSettingsView>) => { const next = { ...s, ...p }; setS(next); axi().saveSettings(p) }

  return (
    <section className="yt-settings">
      <h3>YouTube</h3>
      {youtube.connected ? (
        <div className="yt-account">
          <span>Connected as <strong>{youtube.channel ?? 'your channel'}</strong></span>
          <button onClick={() => axi().disconnectYouTube()}>Disconnect</button>
        </div>
      ) : (
        <button onClick={() => axi().connectYouTube()}>Connect YouTube account (recommended)</button>
      )}

      <label>Stream title template
        <input value={s.titleTemplate} placeholder="EWW Raid - {{date}}" onChange={(e) => update({ titleTemplate: e.target.value })} />
      </label>
      <div className="yt-vars">Variables: {VARS}</div>
      <div className="yt-preview">Preview: <strong>{preview || '—'}</strong></div>
      <div className="yt-hint">Leave blank to be asked for a title each time you go live.</div>

      <label>Date format
        <input value={s.dateFormat} onChange={(e) => update({ dateFormat: e.target.value })} />
      </label>

      <label>Privacy
        <select value={s.privacy} onChange={(e) => update({ privacy: e.target.value as StreamSettingsView['privacy'] })}>
          <option value="public">Public</option>
          <option value="unlisted">Unlisted</option>
          <option value="private">Private</option>
        </select>
      </label>
    </section>
  )
}
```

- [ ] **Step 4: Mount in `SettingsScreen.tsx`**

Import and render `<YouTubeSettings youtube={state.youtube} />` above the existing key UI; relabel the existing key block heading to "Stream key (advanced fallback)". Pull `state` the same way the component already accesses store state.

- [ ] **Step 5: Run tests + build**

Run: `npm -w @axistream/app run test -- youtube-settings` then `npm -w @axistream/app run build`
Expected: PASS + build green.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/components/YouTubeSettings.tsx packages/app/src/renderer/components/SettingsScreen.tsx packages/app/src/renderer/styles.css
git commit -m "feat(ui): youtube settings — connect, template, format, privacy"
```

---

### Task 12: Title prompt on go-live

**Files:**
- Create: `packages/app/src/renderer/components/TitlePromptModal.tsx`
- Modify: `packages/app/src/renderer/components/StreamScreen.tsx`

**Interfaces:**
- Consumes: `state.phase` (reacts to `'NEEDS_TITLE'`), `axi.goLive(title)`.
- Produces: a modal that captures a title and re-invokes `axi.goLive(title)`.

**Behavior:**
- `StreamScreen` Go Live button calls `axi.goLive()` (no args). If main responds with `phase === 'NEEDS_TITLE'`, render `<TitlePromptModal>`.
- Modal: text input + "Go Live" (disabled when empty) and "Cancel". Confirm → `axi.goLive(title)` then hide. Cancel → hide and call `axi.stopStream()`? No — just hide; phase returns to READY via main on next state. (Main leaves phase at `NEEDS_TITLE`; on cancel the renderer requests `axi.getInitialState()` to resync to `READY`. Simpler: Cancel calls `axi.getSettings()`-style no-op and sets local hidden state; main's `NEEDS_TITLE` is replaced when the user retries. To keep state honest, Cancel calls a lightweight resync: `axi.getInitialState().then(store.applyState)`.)

- [ ] **Step 1: Write a render test**

`packages/app/test/title-prompt.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TitlePromptModal } from '../src/renderer/components/TitlePromptModal.js'

const axi = { goLive: vi.fn(async () => {}) }
beforeEach(() => { (globalThis as any).axi = axi; vi.clearAllMocks() })

describe('TitlePromptModal', () => {
  it('disables Go Live until a title is entered, then submits it', () => {
    const onClose = vi.fn()
    render(<TitlePromptModal onClose={onClose} />)
    const go = screen.getByRole('button', { name: /go live/i }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My Stream' } })
    expect(go.disabled).toBe(false)
    fireEvent.click(go)
    expect(axi.goLive).toHaveBeenCalledWith('My Stream')
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @axistream/app run test -- title-prompt`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `TitlePromptModal.tsx`**

```tsx
import { useState } from 'react'
import type { AxiApi } from '../../preload/index.js'

const axi = () => (globalThis as { axi: AxiApi }).axi

export function TitlePromptModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('')
  const submit = () => { if (!title.trim()) return; axi().goLive(title.trim()); onClose() }
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Name your stream</h3>
        <input autoFocus type="text" value={title} placeholder="Stream title"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button disabled={!title.trim()} onClick={submit}>Go Live</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Wire into `StreamScreen.tsx`**

- Render `<TitlePromptModal>` when `state.phase === 'NEEDS_TITLE'`.
- `onClose` resyncs state: `axi.getInitialState().then((s) => store.applyState(s))` (so a cancel returns the UI to READY).
- Leave the existing Go Live button calling `axi.goLive()` (no args).

- [ ] **Step 5: Run tests + build**

Run: `npm -w @axistream/app run test` then `npm -w @axistream/app run build`
Expected: PASS + build green.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/components/TitlePromptModal.tsx packages/app/src/renderer/components/StreamScreen.tsx
git commit -m "feat(ui): prompt for stream title when template is empty"
```

---

## Final verification

- [ ] **Run the whole suite:** `npm test` (both packages) — all green.
- [ ] **Build:** `npm run build` — both packages compile.
- [ ] **Manual smoke (requires Google Cloud prerequisites + a test channel):**
  1. Launch app, open Settings, click **Connect YouTube account**, complete consent in browser, confirm channel name appears.
  2. Set template `EWW Raid - {{date}}`, confirm live preview resolves.
  3. Click **Go Live** → a real broadcast appears on the channel and transitions to live; preview shows the stream.
  4. **Stop** → broadcast completes on YouTube.
  5. Clear the template, **Go Live** → title prompt appears; entering a title goes live with it.
  6. Disconnect account → confirm fallback: paste a stream key and go live (manual mode unchanged).

---

## Self-Review

**Spec coverage:**
- OAuth PKCE + token storage → Tasks 3, 4, 6, 10 (loopback). ✓
- Broadcast lifecycle (create/bind/wait/transition/complete) → Task 5 (`enableAutoStart` covers transition) + Task 7 hooks + Task 10 wiring. ✓
- Title template engine with `{{date}}/{{time}}/{{day}}/{{week}}/{{n}}`, configurable date format, empty→prompt, unknown→empty → Tasks 1, 11, 12. ✓
- Settings: template, date format, privacy (default Public), reusable streamId, counter → Task 2, 10, 11. ✓
- Manual key fallback retained → Tasks 9 (goLive manual branch), 11 (UI), 10 (wiring). ✓
- Error handling: go-live timeout cleanup + orphan broadcast complete → Task 7 (`onStop` on failStart) + Task 5 `complete` + Task 10. ✓
- Live preview of resolved title → Task 9 (`previewTitle`), Task 11 UI. ✓
- OBS stays auth-free → unchanged `ensureCleanProfile`; no OBS account connect anywhere. ✓

**Placeholder scan:** No TBD/TODO; all code steps include full code. The `index.ts` wiring (Task 10 Step 5) is described behaviorally with exact method calls, constants, and helper code rather than a single paste because it threads through an existing 200-line boot file — every required call, branch, and the counter-bump mechanism is specified.

**Type consistency:** `Ingest { server, key }` is defined in both `StreamController.ts` (Task 7) and `YouTubeLive.ts` (Task 5) with identical shape and flows between them via `session.ingest`. `Privacy` is defined once in `StreamSettings.ts` and imported by `YouTubeLive.ts`. `StreamSettingsView` defined in `state.ts` (Task 8), produced by `viewOf` (Task 10), consumed by ipc/preload/UI. `goLive(title?)` widened consistently across ipc (Task 9), preload (Task 9), and main (Task 10). `LoopbackResult` defined in `YouTubeAuth.ts` (Task 6), implemented by `createLoopback` (Task 10).

**Known intentional cross-task build gaps:** Tasks 8–9 leave the package build red until Task 10 completes the `index.ts` handler object. This is called out in each task and is the natural consequence of widening a shared interface before its single implementer is updated.
