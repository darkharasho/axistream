import type { LiveStats } from '../../shared/state.js'

export function StatChips({ stats }: { stats: LiveStats | null }) {
  const s = stats
  return (
    <div className="chips">
      <span className="chip">{s ? `▲ ${s.bitrateKbps} kbps` : '— kbps'}</span>
      <span className="chip good">{s ? `${s.droppedFrames} dropped` : '0 dropped'}</span>
      <span className="chip">{s ? `${s.encoder} · 1080p60` : 'x264 · 1080p60'}</span>
      {s ? <span className="chip">{`CPU ${s.cpuPct}%`}</span> : null}
    </div>
  )
}
