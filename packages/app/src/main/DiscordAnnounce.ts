export interface DiscordAnnounceConfig {
  webhookUrl: string
  title: string
  watchUrl: string
  message?: string
}
export interface DiscordAnnounceResult { ok: boolean; error?: string }

interface DiscordEmbed { title: string; url: string; description: string; color: number }

export type FetchLike = (url: string, init: {
  method: string; headers: Record<string, string>; body: string
}) => Promise<{ ok: boolean; status: number }>

// Best-effort Discord webhook announcement. Never throws: the go-live path
// ignores the result and the Send-test button reads it.
export async function announce(cfg: DiscordAnnounceConfig, fetchFn: FetchLike): Promise<DiscordAnnounceResult> {
  const url = cfg.webhookUrl.trim()
  if (!url) return { ok: false, error: 'no webhook configured' }
  const message = (cfg.message ?? '').trim()
  const payload: { content?: string; embeds: DiscordEmbed[] } = {
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
