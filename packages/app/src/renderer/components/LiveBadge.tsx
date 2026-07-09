import type { StreamPhase } from '../../shared/state.js'

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000); const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function LiveBadge({ phase, liveUnconfirmed, durationMs }:
  { phase: StreamPhase; liveUnconfirmed: boolean; durationMs: number }) {
  const live = phase === 'LIVE' || phase === 'RECONNECTING'
  if (phase === 'STARTING_ON_YOUTUBE') {
    return <span className="badge starting">● Starting on YouTube…</span>
  }
  if (!live) return <span className="badge">● PREVIEW</span>
  return (
    <>
      <span className="badge live"><span aria-hidden>● </span>LIVE</span>
      <span className="pill mono">{fmt(durationMs)}</span>
      {liveUnconfirmed
        ? <span className="pill warn">YouTube hasn't started your broadcast yet — check YouTube Studio</span>
        : null}
    </>
  )
}
