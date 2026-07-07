# Discord Go-Live Webhook Announcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On OAuth go-live, POST a Discord webhook announcement (optional ping line + a rich embed linking to the YouTube watch page).

**Architecture:** A pure best-effort `announce()` module (injected `fetch`) isolated from the network; two new persisted string settings (`discordWebhookUrl`, `discordMessage`) exposed to the renderer; the announcement fired inside the existing `onIngestActive` go-live callback; a `testDiscordWebhook()` IPC driving a "Send test" button.

**Tech Stack:** Electron 31 main/preload/renderer, React 18, TypeScript 5.5 (ESM/NodeNext), Vitest 2 (fork pool ≤2). Global `fetch` is available in the Electron main process (already used for the GW2 API at `index.ts:71`).

## Global Constraints

- 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on all relative imports.
- OBS/side-effect calls are best-effort — the announcement must NEVER throw out of, block, or fail go-live.
- Announcement is OAuth-only: manual-key go-live has no broadcast id / computed title and is left unchanged.
- `announce()` makes NO network call when the webhook URL is empty/whitespace.
- Embed color is `16711680` (0xFF0000). Watch URL is `https://www.youtube.com/watch?v=<broadcastId>`.
- vitest: `npm -w @axistream/app run test`. Typecheck gate: `cd packages/app && npx tsc --noEmit -p tsconfig.json`.

---

### Task 1: DiscordAnnounce pure module

**Files:**
- Create: `packages/app/src/main/DiscordAnnounce.ts`
- Test: `packages/app/test/discord-announce.test.ts`

**Interfaces:**
- Consumes: nothing (pure; injected `FetchLike`).
- Produces:
  - `interface DiscordAnnounceConfig { webhookUrl: string; title: string; watchUrl: string; message?: string }`
  - `interface DiscordAnnounceResult { ok: boolean; error?: string }`
  - `type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>`
  - `async function announce(cfg: DiscordAnnounceConfig, fetchFn: FetchLike): Promise<DiscordAnnounceResult>`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/test/discord-announce.test.ts
import { describe, it, expect, vi } from 'vitest'
import { announce, type FetchLike } from '../src/main/DiscordAnnounce.js'

const base = { webhookUrl: 'https://discord.com/api/webhooks/1/abc', title: 'WvW Raid', watchUrl: 'https://www.youtube.com/watch?v=xyz' }

describe('announce', () => {
  it('posts content + embed as JSON when a message is set', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => ({ ok: true, status: 204 }))
    const r = await announce({ ...base, message: '@here raid starting' }, fetchFn)
    expect(r).toEqual({ ok: true })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(base.webhookUrl)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body)
    expect(body.content).toBe('@here raid starting')
    expect(body.embeds[0]).toMatchObject({ title: 'WvW Raid', url: base.watchUrl, color: 16711680 })
  })

  it('omits content when the message is empty', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => ({ ok: true, status: 204 }))
    await announce({ ...base, message: '   ' }, fetchFn)
    const body = JSON.parse(fetchFn.mock.calls[0][1].body)
    expect('content' in body).toBe(false)
    expect(body.embeds).toHaveLength(1)
  })

  it('makes no network call when the webhook is empty', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => ({ ok: true, status: 204 }))
    const r = await announce({ ...base, webhookUrl: '  ' }, fetchFn)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(r.ok).toBe(false)
  })

  it('returns an error result on a non-2xx response (no throw)', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => ({ ok: false, status: 404 }))
    const r = await announce({ ...base }, fetchFn)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('404')
  })

  it('returns an error result when fetch rejects (no throw)', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => { throw new Error('network down') })
    const r = await announce({ ...base }, fetchFn)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('network down')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm -w @axistream/app run test -- discord-announce`
Expected: FAIL — `announce` not defined / module missing.

- [ ] **Step 3: Write the implementation**

```ts
// packages/app/src/main/DiscordAnnounce.ts
export interface DiscordAnnounceConfig {
  webhookUrl: string
  title: string
  watchUrl: string
  message?: string
}
export interface DiscordAnnounceResult { ok: boolean; error?: string }

export type FetchLike = (url: string, init: {
  method: string; headers: Record<string, string>; body: string
}) => Promise<{ ok: boolean; status: number }>

// Best-effort Discord webhook announcement. Never throws: the go-live path
// ignores the result and the Send-test button reads it.
export async function announce(cfg: DiscordAnnounceConfig, fetchFn: FetchLike): Promise<DiscordAnnounceResult> {
  const url = cfg.webhookUrl.trim()
  if (!url) return { ok: false, error: 'no webhook configured' }
  const message = (cfg.message ?? '').trim()
  const payload: { content?: string; embeds: unknown[] } = {
    embeds: [{ title: cfg.title, url: cfg.watchUrl, description: '🔴 Live now on YouTube', color: 16711680 }],
  }
  if (message) payload.content = message
  try {
    const res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) {
      console.warn(`[discord] webhook returned ${res.status}`)
      return { ok: false, error: `discord returned ${res.status}` }
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[discord] webhook post failed: ${msg}`)
    return { ok: false, error: msg }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm -w @axistream/app run test -- discord-announce`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/DiscordAnnounce.ts packages/app/test/discord-announce.test.ts
git commit -m "feat(discord): best-effort webhook announce module"
```

---

### Task 2: Settings fields (data + view)

**Files:**
- Modify: `packages/app/src/main/StreamSettings.ts` (interface, `DEFAULT_SETTINGS`, load/sanitize path)
- Modify: `packages/app/src/shared/state.ts` (`StreamSettingsView`)
- Modify: `packages/app/src/main/index.ts` (`viewOf`)
- Test: `packages/app/test/stream-settings.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `StreamSettingsData` and `StreamSettingsView` each gain `discordWebhookUrl: string` and `discordMessage: string` (default `''`). `viewOf(data)` copies both through.

**Context:** `StreamSettings.ts` load path validates each string field with `typeof raw.X === 'string' ? raw.X : DEFAULT_SETTINGS.X` (see `titleTemplate` at ~line 90). `viewOf` in `index.ts` currently returns `{ titleTemplate, dateFormat, privacy }` — find it (`grep -n "viewOf" packages/app/src/main/index.ts`) and add the two fields.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/app/test/stream-settings.test.ts (inside the existing describe)
  it('defaults the discord fields to empty and round-trips them', () => {
    const s = new StreamSettings(file)
    expect(s.load().discordWebhookUrl).toBe('')
    expect(s.load().discordMessage).toBe('')
    s.patch({ discordWebhookUrl: 'https://discord.com/api/webhooks/1/x', discordMessage: '@here' })
    const reloaded = new StreamSettings(file).load()
    expect(reloaded.discordWebhookUrl).toBe('https://discord.com/api/webhooks/1/x')
    expect(reloaded.discordMessage).toBe('@here')
  })

  it('sanitizes non-string discord fields to empty', () => {
    const s = new StreamSettings(file)
    s.save({ ...DEFAULT_SETTINGS, discordWebhookUrl: 123 as unknown as string, discordMessage: null as unknown as string })
    const loaded = new StreamSettings(file).load()
    expect(loaded.discordWebhookUrl).toBe('')
    expect(loaded.discordMessage).toBe('')
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w @axistream/app run test -- stream-settings`
Expected: FAIL — `discordWebhookUrl` is `undefined`.

- [ ] **Step 3: Implement the settings fields**

In `packages/app/src/main/StreamSettings.ts`, add to the `StreamSettingsData` interface (after `maskStyle`):
```ts
  discordWebhookUrl: string
  discordMessage: string
```
Add to `DEFAULT_SETTINGS`:
```ts
  discordWebhookUrl: '',
  discordMessage: '',
```
In the load/sanitize object (where `titleTemplate` is validated), add:
```ts
        discordWebhookUrl: typeof raw.discordWebhookUrl === 'string' ? raw.discordWebhookUrl : DEFAULT_SETTINGS.discordWebhookUrl,
        discordMessage: typeof raw.discordMessage === 'string' ? raw.discordMessage : DEFAULT_SETTINGS.discordMessage,
```

In `packages/app/src/shared/state.ts`, extend `StreamSettingsView`:
```ts
export interface StreamSettingsView {
  titleTemplate: string
  dateFormat: string
  privacy: 'public' | 'unlisted' | 'private'
  discordWebhookUrl: string
  discordMessage: string
}
```

In `packages/app/src/main/index.ts`, extend `viewOf` to include the two fields, e.g.:
```ts
  const viewOf = (d: StreamSettingsData): StreamSettingsView => ({
    titleTemplate: d.titleTemplate, dateFormat: d.dateFormat, privacy: d.privacy,
    discordWebhookUrl: d.discordWebhookUrl, discordMessage: d.discordMessage,
  })
```
(Match the existing `viewOf` shape exactly — only add the two fields.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w @axistream/app run test -- stream-settings`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: no errors. (If `settings-screen.test.tsx` or `youtube-settings.test.tsx` mock `getSettings`/`saveSettings` with a 3-field object literal typed as `StreamSettingsView`, add `discordWebhookUrl: '', discordMessage: ''` to those mocks so the types satisfy — do this only if tsc/tests flag it.)

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/main/StreamSettings.ts packages/app/src/shared/state.ts packages/app/src/main/index.ts packages/app/test/stream-settings.test.ts
git commit -m "feat(discord): persist + expose discordWebhookUrl/discordMessage settings"
```

---

### Task 3: IPC channel, preload, AxiApi + go-live wiring

**Files:**
- Modify: `packages/app/src/shared/state.ts` (`CH` enum, `AxiApi` method)
- Modify: `packages/app/src/main/ipc.ts` (`Handlers` decl + `ipcMain.handle` registration)
- Modify: `packages/app/src/preload/index.ts` (bind the invoke)
- Modify: `packages/app/src/main/index.ts` (`realFetch` adapter, `testDiscordWebhook` handler, go-live `onIngestActive` announce)
- No new test file — index.ts wiring is review-verified; the type additions are covered by tsc.

**Interfaces:**
- Consumes: `announce`, `DiscordAnnounceResult`, `FetchLike` from Task 1; the settings fields from Task 2.
- Produces: `AxiApi.testDiscordWebhook(): Promise<DiscordAnnounceResult>`; `CH.testDiscordWebhook = 'axi:testDiscordWebhook'`.

- [ ] **Step 1: Add the channel + AxiApi method (state.ts)**

In `CH` (before the closing `} as const`):
```ts
  testDiscordWebhook: 'axi:testDiscordWebhook',
```
In `AxiApi` (after `fitWindowToCapture()`), and import/declare the result type. Since `DiscordAnnounceResult` lives in the main package, re-declare a structural type in `state.ts` (shared, no main imports) to keep the renderer dependency-free:
```ts
export interface DiscordTestResult { ok: boolean; error?: string }
```
```ts
  testDiscordWebhook(): Promise<DiscordTestResult>
```

- [ ] **Step 2: Declare + register the IPC handler (ipc.ts)**

Add to the `Handlers` interface:
```ts
  testDiscordWebhook(): Promise<DiscordTestResult>
```
(import `DiscordTestResult` alongside the other `state.js` types.)
Register in `registerIpc`:
```ts
  ipcMain.handle(CH.testDiscordWebhook, () => handlers.testDiscordWebhook())
```

- [ ] **Step 3: Bind the preload invoke (preload/index.ts)**

Add alongside the other bindings:
```ts
  testDiscordWebhook: () => ipcRenderer.invoke(CH.testDiscordWebhook) as Promise<import('../shared/state.js').DiscordTestResult>,
```
(match the file's existing `as Promise<...>` style; if it imports types at top, use that import instead of inline.)

- [ ] **Step 4: Wire the main handler + go-live announce (index.ts)**

Add the imports:
```ts
import { announce, type FetchLike } from './DiscordAnnounce.js'
```
Add a real fetch adapter near the existing `fetchJson` (~line 70):
```ts
const realFetch: FetchLike = (url, init) => fetch(url, init).then((r) => ({ ok: r.ok, status: r.status }))
```
Add the handler (near `getSettings`/`saveSettings`):
```ts
    testDiscordWebhook: async () => {
      const cfg = settings.load()
      return announce({
        webhookUrl: cfg.discordWebhookUrl,
        title: 'AxiStream test announcement',
        watchUrl: 'https://www.youtube.com/@axistream',
        message: cfg.discordMessage,
      }, realFetch)
    },
```
In the OAuth `goLive` branch, extend the existing `onIngestActive` callback (do NOT change its `confirmLive` line — append after it):
```ts
          onIngestActive: async () => {
            try { await live.confirmLive(session!.broadcastId) } catch { /* best-effort */ }
            const cfg = settings.load()
            if (cfg.discordWebhookUrl.trim()) {
              await announce({
                webhookUrl: cfg.discordWebhookUrl,
                title,
                watchUrl: `https://www.youtube.com/watch?v=${session!.broadcastId}`,
                message: cfg.discordMessage,
              }, realFetch).catch(() => {})
            }
          },
```
(`title` is the local computed at the top of the OAuth branch; `session` is in scope in the callback as elsewhere.)

- [ ] **Step 5: Typecheck + full test run**

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.
Run: `npm -w @axistream/app run test`
Expected: all pass (no behavior regressions).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/main/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/index.ts
git commit -m "feat(discord): testDiscordWebhook IPC + fire announce on go-live ingest-active"
```

---

### Task 4: Settings UI — Discord announcement block

**Files:**
- Modify: `packages/app/src/renderer/components/YouTubeSettings.tsx`
- Test: `packages/app/test/youtube-settings.test.tsx`

**Interfaces:**
- Consumes: `s.discordWebhookUrl` / `s.discordMessage` (Task 2 view fields); `axi().testDiscordWebhook()` (Task 3).
- Produces: no new exports.

**Context:** `YouTubeSettings` loads settings into local state `s`, edits via `update(p)` which calls `saveSettings(p)`. Add the new block inside the `{s && (<> ... </>)}` fragment, after the Privacy control. The test mocks `getSettings`/`saveSettings`; those mocks must gain `discordWebhookUrl: ''`, `discordMessage: ''` and a `testDiscordWebhook` mock.

- [ ] **Step 1: Write the failing tests**

Update the mock object at the top of `youtube-settings.test.tsx`:
```ts
const axi = {
  connectYouTube: vi.fn(async () => {}),
  disconnectYouTube: vi.fn(async () => {}),
  getSettings: vi.fn(async () => ({ titleTemplate: 'EWW - {{date}}', dateFormat: 'YYYY-MM-DD', privacy: 'public' as const, discordWebhookUrl: '', discordMessage: '' })),
  saveSettings: vi.fn(async (p: any) => ({ titleTemplate: 'EWW - {{date}}', dateFormat: 'YYYY-MM-DD', privacy: 'public' as const, discordWebhookUrl: '', discordMessage: '', ...p })),
  previewTitle: vi.fn(async () => 'EWW - 2026-06-24'),
  testDiscordWebhook: vi.fn(async () => ({ ok: true })),
}
```
Add tests inside the describe:
```ts
  it('saves the discord webhook url on edit', async () => {
    render(<YouTubeSettings youtube={{ connected: true, channel: 'My Channel' }} />)
    const input = await screen.findByLabelText(/discord webhook/i)
    fireEvent.change(input, { target: { value: 'https://discord.com/api/webhooks/1/tok' } })
    expect(axi.saveSettings).toHaveBeenCalledWith({ discordWebhookUrl: 'https://discord.com/api/webhooks/1/tok' })
  })

  it('Send test is disabled until a webhook is present, then calls testDiscordWebhook and shows success', async () => {
    render(<YouTubeSettings youtube={{ connected: true, channel: 'My Channel' }} />)
    const btn = await screen.findByRole('button', { name: /send test/i })
    expect(btn).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/discord webhook/i), { target: { value: 'https://discord.com/api/webhooks/1/tok' } })
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    await waitFor(() => expect(axi.testDiscordWebhook).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText(/sent/i)).toBeInTheDocument())
  })

  it('shows the error text when the test fails', async () => {
    axi.testDiscordWebhook.mockResolvedValueOnce({ ok: false, error: 'discord returned 404' })
    render(<YouTubeSettings youtube={{ connected: true, channel: 'My Channel' }} />)
    fireEvent.change(await screen.findByLabelText(/discord webhook/i), { target: { value: 'https://x' } })
    fireEvent.click(screen.getByRole('button', { name: /send test/i }))
    await waitFor(() => expect(screen.getByText(/discord returned 404/i)).toBeInTheDocument())
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm -w @axistream/app run test -- youtube-settings`
Expected: FAIL — no webhook input / Send test button.

- [ ] **Step 3: Implement the UI block**

Add local state for the test result at the top of the component:
```ts
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
```
Add, inside the `{s && (<> ... </>)}` fragment after the Privacy `<label>`:
```tsx
          <div className="yt-discord">
            <label>Discord webhook URL
              <input value={s.discordWebhookUrl} placeholder="https://discord.com/api/webhooks/…"
                onChange={(e) => update({ discordWebhookUrl: e.target.value })} />
            </label>
            <div className="yt-hint">Server Settings → Integrations → Webhooks. Announces your stream when you go live.</div>
            <label>Announcement message (optional)
              <input value={s.discordMessage} placeholder="@here WvW raid starting"
                onChange={(e) => update({ discordMessage: e.target.value })} />
            </label>
            <div className="yt-hint">Prepended above the embed — use <code>@here</code> or a role mention to ping.</div>
            <div className="yt-discord-test">
              <button className="btn ghost sm" disabled={!s.discordWebhookUrl.trim()}
                onClick={async () => { setTestMsg(null); const r = await axi().testDiscordWebhook(); setTestMsg({ ok: r.ok, text: r.ok ? 'Sent ✓' : (r.error ?? 'Failed') }) }}>
                Send test
              </button>
              {testMsg && <span className={testMsg.ok ? 'yt-test-ok' : 'yt-test-err'}>{testMsg.text}</span>}
            </div>
          </div>
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm -w @axistream/app run test -- youtube-settings`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `npm -w @axistream/app run test`
Expected: all pass.
Run: `cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/components/YouTubeSettings.tsx packages/app/test/youtube-settings.test.tsx
git commit -m "feat(discord): settings UI — webhook + message inputs and Send test"
```

---

## Self-Review

- **Spec coverage:** DiscordAnnounce module (Task 1) ✓; two settings fields + view (Task 2) ✓; go-live wiring inside `onIngestActive` + OAuth-only + watch URL (Task 3) ✓; `testDiscordWebhook` IPC (Task 3) ✓; UI block with webhook/message inputs + Send test ✓/✗ (Task 4) ✓; best-effort/no-throw and empty-webhook-no-call are enforced in Task 1 and asserted ✓.
- **Type consistency:** `DiscordAnnounceResult` (main) vs `DiscordTestResult` (shared, structurally identical) — the shared type keeps the renderer/preload free of main-package imports; the IPC returns the main result which is assignable to the shared shape. `announce` signature identical across Tasks 1/3. `StreamSettingsView` gains exactly the two fields used by Task 4.
- **Placeholder scan:** none — every step carries full code.
- **Styling note:** `.yt-discord`, `.yt-test-ok`, `.yt-test-err` are optional CSS hooks; the feature works unstyled. Add minimal CSS only if the whole-branch review calls for it (not required for tests).
