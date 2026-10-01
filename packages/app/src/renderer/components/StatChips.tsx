import type { LiveStats, CaptureMeta } from '../../shared/state.js'

export function StatChips({ stats, capture, encoder }: { stats: LiveStats | null; capture: CaptureMeta | null; encoder: string }) {
  // Output resolution actually sent to YouTube (height-based label, e.g. 1440p60).
  const res = capture ? `${capture.outputHeight}p${capture.fps}` : '—'
  // Idle (not streaming): just the encoder. Live: full health row.
  if (!stats) {
    return (
      <div className="axi-row">
        <span className="axi-chip axi-chip--meta">{encoder} · {res}</span>
      </div>
    )
  }
  const droppedClass = stats.droppedPct > 5 ? 'axi-chip--danger' : stats.droppedPct >= 1 ? 'axi-chip--warn' : 'axi-chip--ok'
  const dropped = stats.droppedPct >= 1
    ? `${stats.droppedFrames} dropped · ${stats.droppedPct}%`
    : `${stats.droppedFrames} dropped`
  return (
    <div className="axi-row">
      <span className="axi-chip axi-chip--meta">{`▲ ${stats.bitrateKbps} kbps`}</span>
      <span className={`axi-chip ${droppedClass}`}>{dropped}</span>
      <span className="axi-chip axi-chip--meta">{`${stats.encoder} · ${res}`}</span>
      <span className="axi-chip axi-chip--meta">{`CPU ${stats.cpuPct}%`}</span>
    </div>
  )
}
