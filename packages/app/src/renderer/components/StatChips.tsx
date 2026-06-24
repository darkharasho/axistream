import type { LiveStats } from '../../shared/state.js'

export function StatChips({ stats }: { stats: LiveStats | null }) {
  // Idle (not streaming): just the encoder. Live: full health row.
  if (!stats) {
    return (
      <div className="chips">
        <span className="chip">x264 · 1080p60</span>
      </div>
    )
  }
  return (
    <div className="chips">
      <span className="chip">{`▲ ${stats.bitrateKbps} kbps`}</span>
      <span className="chip good">{`${stats.droppedFrames} dropped`}</span>
      <span className="chip">{`${stats.encoder} · 1080p60`}</span>
      <span className="chip">{`CPU ${stats.cpuPct}%`}</span>
    </div>
  )
}
