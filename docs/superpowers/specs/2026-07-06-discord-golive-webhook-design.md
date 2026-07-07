# Discord Go-Live Webhook Announcement — Design

**Date:** 2026-07-06
**Status:** Approved (design); pending implementation plan
**Scope:** When AxiStream goes live in OAuth mode, POST an announcement to a
user-configured Discord webhook — an optional ping/message line plus a rich
embed linking to the YouTube watch page. Lets a GW2 WvW guild get pinged the
moment a raid stream starts.

## Purpose

WvW guilds coordinate in Discord. Auto-announcing "we're live" with a
clickable link — and an optional role ping — the instant YouTube confirms the
stream is live removes the manual "posting the link in Discord" step from the
go-live flow.

## Non-goals

- **Manual-key mode.** Without OAuth there is no broadcast id (no watch URL)
  and no app-computed title, so there is nothing to announce. The
  announcement fires only in OAuth go-live. Manual-key go-live is unchanged.
- Announcing stream *end*, viewer counts, or periodic updates. One message,
  at go-live.
- Slack / generic webhooks, multiple webhooks, per-stream message overrides,
  message templating with `{{vars}}`. The message field is a static string
  (which may contain Discord's own ping syntax); the embed is built from the
  live stream's title and URL. YAGNI until asked.
- Editing/deleting the announcement after posting.

## Architecture

Layered so the network call is isolated and pure-testable, the settings carry
the two new fields, and go-live wiring stays a best-effort side effect.

| Unit | Responsibility |
|------|----------------|
| `DiscordAnnounce.ts` (new, app main) | pure: given a config + an injected `fetch`, build the Discord webhook JSON payload and POST it. Best-effort — never throws; returns a structured result. |
| `StreamSettings.ts` (extend) | two new persisted string fields `discordWebhookUrl`, `discordMessage`; sanitized as strings; defaulted to `''`. |
| `state.ts` `StreamSettingsView` (extend) | expose both fields to the renderer. |
| `index.ts` `viewOf` + go-live + a new IPC handler | map the fields into the view; fire the announcement inside the existing `onIngestActive` callback; add `testDiscordWebhook()`. |
| `ipc.ts` (extend) | declare + register the `testDiscordWebhook` channel. |
| `YouTubeSettings.tsx` (extend) | a "Discord announcement" block: webhook URL input, message input, and a "Send test" button showing ✓ / ✗. |

### DiscordAnnounce.ts

```ts
export interface DiscordAnnounceConfig {
  webhookUrl: string
  title: string        // the live stream's title
  watchUrl: string     // https://www.youtube.com/watch?v=<broadcastId>
  message?: string     // optional content line (may contain @here / <@&roleid>)
}
export interface DiscordAnnounceResult { ok: boolean; error?: string }

export type FetchLike = (url: string, init: {
  method: string; headers: Record<string, string>; body: string
}) => Promise<{ ok: boolean; status: number }>

export async function announce(cfg: DiscordAnnounceConfig, fetchFn: FetchLike): Promise<DiscordAnnounceResult>
```

Behaviour:

- If `cfg.webhookUrl` is empty/whitespace → return `{ ok: false, error: 'no webhook configured' }` and make **no** network call.
- Build the payload:
  ```jsonc
  {
    "content": "<message or omitted>",        // only present when message is non-empty
    "embeds": [{
      "title": "<title>",
      "url": "<watchUrl>",
      "description": "🔴 Live now on YouTube",
      "color": 16711680                         // 0xFF0000 red
    }]
  }
  ```
  Omit the `content` key entirely when `message` is empty/whitespace. The
  payload always carries the embed, so an omitted `content` is still a valid
  Discord webhook post.
- POST `application/json` to `webhookUrl`. On a 2xx → `{ ok: true }`. On
  non-2xx → `{ ok: false, error: 'discord returned <status>' }` + `console.warn`.
  On a thrown/rejected fetch → `{ ok: false, error: <message> }` + `console.warn`.
- Never throws out. The go-live path ignores the result; the test button reads it.

The real caller passes a thin adapter over Node/undici `fetch` (available in
the Electron main process) as `FetchLike`.

### Settings

`StreamSettingsData` gains:
```ts
discordWebhookUrl: string   // default ''
discordMessage: string      // default ''
```
`DEFAULT_SETTINGS` sets both to `''`. The load/sanitize path validates each
with the existing string guard: `typeof raw.x === 'string' ? raw.x : DEFAULT`.
`StreamSettingsView` gains the same two fields; `viewOf` copies them through.

### Go-live wiring (index.ts, OAuth branch)

The watch URL is derived from the broadcast id:
`const watchUrl = ` `` `https://www.youtube.com/watch?v=${session.broadcastId}` `` .

Inside the existing `onIngestActive` callback — which already runs
`confirmLive` when YouTube reports the ingest active — after the confirm,
best-effort announce:

```ts
onIngestActive: async () => {
  try { await live.confirmLive(session!.broadcastId) } catch { /* best-effort */ }
  const cfg = settings.load()
  if (cfg.discordWebhookUrl.trim()) {
    await announce({
      webhookUrl: cfg.discordWebhookUrl,
      title,                                   // already computed above
      watchUrl: `https://www.youtube.com/watch?v=${session!.broadcastId}`,
      message: cfg.discordMessage,
    }, realFetch).catch(() => {})              // announce already swallows; belt-and-suspenders
  }
},
```

`title` is the same string passed to `live.startSession`. Firing on
ingest-active (not at click) means we only announce a stream that actually
reached YouTube. The announcement adds no latency to and cannot fail go-live.

### IPC: testDiscordWebhook

```ts
// ipc.ts Handlers
testDiscordWebhook(): Promise<DiscordAnnounceResult>
```
Handler builds a sample announcement from the *saved* settings so the user
tests the real webhook/message they typed:
```ts
testDiscordWebhook: async () => {
  const cfg = settings.load()
  return announce({
    webhookUrl: cfg.discordWebhookUrl,
    title: 'AxiStream test announcement',
    watchUrl: 'https://www.youtube.com/@axistream',
    message: cfg.discordMessage,
  }, realFetch)
}
```
Returns the structured result so the renderer can show ✓ / the error text.
(The renderer saves the field first, then calls test — so the saved config is
current.)

### UI (YouTubeSettings.tsx)

A new labelled block under the existing title/privacy controls:

- **Webhook URL** — a text `<input>` bound to `s.discordWebhookUrl`, saved via
  the existing `update({ discordWebhookUrl })` on change (same debounce/blur
  pattern the title template uses). Placeholder shows the
  `https://discord.com/api/webhooks/...` shape. A short helper line explains
  where to get one (Discord → Server Settings → Integrations → Webhooks).
- **Message (optional)** — a text `<input>` bound to `s.discordMessage`,
  helper text: "Prepended to the announcement — use `@here` or a role mention
  to ping.".
- **Send test** — a button that calls `axi.testDiscordWebhook()` and shows a
  transient ✓ ("Sent") or ✗ with the error string. Disabled when the webhook
  field is empty.

## Error handling

Every layer best-effort: empty webhook → no call; non-2xx / network failure →
warned and swallowed; go-live never blocked or failed by the announcement. The
only place a failure is surfaced to the user is the explicit "Send test"
button, by design.

## Testing

- **DiscordAnnounce** (injected `FetchLike`):
  - builds `content` + `embed` when message is non-empty; POSTs to the URL as JSON.
  - **omits** `content` when message is empty; embed still present.
  - empty/whitespace `webhookUrl` → `{ ok: false }` and fetch **not** called.
  - 204/200 → `{ ok: true }`; 400/404 → `{ ok: false, error contains status }`.
  - fetch rejects → `{ ok: false, error }`, no throw.
- **StreamSettings**: `discordWebhookUrl`/`discordMessage` round-trip through
  save/load; non-string raw values sanitize to `''`; `DEFAULT_SETTINGS` has both `''`.
- **viewOf / StreamSettingsView**: both fields appear in the view (type + a
  round-trip through `getSettings`/`saveSettings` in the existing settings-screen test).
- **YouTubeSettings**: renders the webhook + message inputs; editing calls
  `saveSettings` with the field; "Send test" calls `testDiscordWebhook` and
  renders ✓ on `{ ok: true }` and the error on `{ ok: false }`; button disabled
  when webhook empty.
- **Go-live wiring**: review-verified (no harness for index.ts) — announcement
  fires inside `onIngestActive` only when a webhook is set, is `.catch`-guarded,
  and uses the same `title` + a `watch?v=<broadcastId>` URL.
- **Manual smoke**: paste a real webhook, click Send test → embed appears in the
  Discord channel; then a real OAuth go-live posts the live announcement with
  the working watch link and the ping.
