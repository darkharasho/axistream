import type { LiveStats, CaptureMeta } from '../../shared/state.js'

export function StatChips({ stats, capture }: { stats: LiveStats | null; capture: CaptureMeta | null }) {
  // Output resolution actually sent to YouTube (height-based label, e.g. 1440p60).
  const res = capture ? `${capture.outputHeight}p${capture.fps}` : '—'
  // Idle (not streaming): just the encoder. Live: full health row.
  if (!stats) {
    return (
      <div className="chips">
        <span className="chip">x264 · {res}</span>
      </div>
    )
  }
  return (
    <div className="chips">
      <span className="chip">{`▲ ${stats.bitrateKbps} kbps`}</span>
      <span className="chip good">{`${stats.droppedFrames} dropped`}</span>
      <span className="chip">{`${stats.encoder} · ${res}`}</span>
      <span className="chip">{`CPU ${stats.cpuPct}%`}</span>
    </div>
  )
}
