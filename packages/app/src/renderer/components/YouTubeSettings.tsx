import { useEffect, useState } from 'react'
import type { AxiApi, StreamSettingsView } from '../../shared/state.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi
const VARS = '{{date}} · {{time}} · {{day}} · {{week}} · {{n}} · {{character}} · {{class}} · {{map}} · {{race}} · {{team}} (GW2, while in a map)'

export function YouTubeSettings({ youtube }: { youtube: { connected: boolean; channel: string | null } }) {
  const [s, setS] = useState<StreamSettingsView | null>(null)
  const [preview, setPreview] = useState('')
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => { axi().getSettings().then(setS) }, [])
  useEffect(() => {
    if (!s) return
    const id = setTimeout(() => { axi().previewTitle(s.titleTemplate).then(setPreview) }, 200)
    return () => clearTimeout(id)
  }, [s?.titleTemplate, s?.dateFormat])

  const update = (p: Partial<StreamSettingsView>) => {
    if (!s) return
    const next = { ...s, ...p }
    setS(next)
    axi().saveSettings(p)
  }

  const sendDiscordTest = async () => {
    setTestMsg(null)
    const r = await axi().testDiscordWebhook()
    setTestMsg({ ok: r.ok, text: r.ok ? 'Sent ✓' : (r.error ?? 'Failed') })
  }

  return (
    <section className="yt-settings">
      <h3>YouTube</h3>
      {youtube.connected ? (
        <div className="yt-account">
          <span>Connected as <strong>{youtube.channel ?? 'your channel'}</strong></span>
          <button className="btn ghost sm" onClick={() => axi().disconnectYouTube()}>Disconnect</button>
        </div>
      ) : (
        <button className="btn primary sm yt-connect" onClick={() => axi().connectYouTube()}>Connect YouTube account</button>
      )}

      {s && (
        <>
          <label>Stream title template
            <input value={s.titleTemplate} placeholder="Raid night - {{date}}" onChange={(e) => update({ titleTemplate: e.target.value })} />
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

          <div className="yt-discord">
            <h4 className="yt-discord-head">Discord announcement</h4>
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
              <button className="btn ghost sm" disabled={!s.discordWebhookUrl.trim()} onClick={sendDiscordTest}>
                Send test
              </button>
              {testMsg && <span className={testMsg.ok ? 'yt-test-ok' : 'yt-test-err'}>{testMsg.text}</span>}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
