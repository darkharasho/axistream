import { useEffect, useState } from 'react'
import type { AxiApi, StreamSettingsView } from '../../shared/state.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi
const VARS = '{{date}} · {{time}} · {{day}} · {{week}} · {{n}} · {{character}} · {{class}} · {{map}} · {{race}} (GW2, while in a map)'

export function YouTubeSettings({ youtube }: { youtube: { connected: boolean; channel: string | null } }) {
  const [s, setS] = useState<StreamSettingsView | null>(null)
  const [preview, setPreview] = useState('')

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
        </>
      )}
    </section>
  )
}
