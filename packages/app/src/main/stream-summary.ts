import type { LiveStats, StreamSummary } from '../shared/state.js'

export interface SummaryExtra {
  watchUrl: string | null
  recordingPath: string | null
  recordingStillActive: boolean
  endedWithError: boolean
}

export interface SummaryAccumulator {
  sample(s: LiveStats): void
  snapshot(extra: SummaryExtra): StreamSummary
  reset(): void
}

/**
 * Accumulates the figures the end-of-stream summary reports.
 *
 * OBS's stats are instantaneous and gone once the stream stops, so nothing here
 * can be recomputed after the fact — the summary is only as good as what was
 * sampled while live.
 */
export function createSummaryAccumulator(): SummaryAccumulator {
  let bitrateSum = 0
  let bitrateCount = 0
  let peakDroppedPct = 0
  let last: LiveStats | null = null

  return {
    sample(s) {
      // Skip zero bitrate: OBS reports it on the first tick or two and during a
      // reconnect, and averaging those in makes a healthy stream look bad.
      if (s.bitrateKbps > 0) { bitrateSum += s.bitrateKbps; bitrateCount++ }
      if (s.droppedPct > peakDroppedPct) peakDroppedPct = s.droppedPct
      last = s
    },
    snapshot(extra) {
      return {
        durationMs: last?.durationMs ?? 0,
        avgBitrateKbps: bitrateCount ? Math.round(bitrateSum / bitrateCount) : 0,
        peakDroppedPct,
        // Cumulative for the session in OBS, so the last sample is authoritative.
        droppedFrames: last?.droppedFrames ?? 0,
        droppedPct: last?.droppedPct ?? 0,
        encoder: last?.encoder ?? '',
        ...extra,
      }
    },
    reset() {
      bitrateSum = 0
      bitrateCount = 0
      peakDroppedPct = 0
      last = null
    },
  }
}
