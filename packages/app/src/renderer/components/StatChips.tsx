import type { LiveStats, CaptureMeta } from '../../shared/state.js'

export function StatChips({ stats, capture, encoder }: { stats: LiveStats | null; capture: CaptureMeta | null; encoder: string }) {
  // Output resolution actually sent to YouTube (height-based label, e.g. 1440p60).
  const res = capture ? `${capture.outputHeight}p${capture.fps}` : '—'
  // Idle (not streaming): just the encoder. Live: full health row.
  if (!stats) {
    return (
      <div className="chips">
        <span className="chip">{encoder} · {res}</span>
      </div>
    )
  }
  const droppedClass = stats.droppedPct > 5 ? 'bad' : stats.droppedPct >= 1 ? 'warn' : 'good'
  const dropped = stats.droppedPct >= 1
    ? `${stats.droppedFrames} dropped · ${stats.droppedPct}%`
    : `${stats.droppedFrames} dropped`
  return (
    <div className="chips">
      <span className="chip">{`▲ ${stats.bitrateKbps} kbps`}</span>
      <span className={`chip ${droppedClass}`}>{dropped}</span>
      <span className="chip">{`${stats.encoder} · ${res}`}</span>
      <span className="chip">{`CPU ${stats.cpuPct}%`}</span>
    </div>
  )
}
