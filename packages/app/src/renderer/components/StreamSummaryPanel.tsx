import { useState } from 'react'
import { Link, Check, ExternalLink, FolderOpen, Square } from 'lucide-react'
import type { AxiApi, StreamSummary } from '../../shared/state.js'
import { formatElapsed } from './RecordButton.js'

/** A bare percentage means nothing to someone who has never read an OBS log.
 *  Same principle as the health chips: state the number, then say what it meant. */
export function droppedVerdict(pct: number): string {
  if (pct < 0.5) return 'clean'
  if (pct < 2) return 'a few frames lost'
  return 'viewers likely saw stuttering'
}

export function StreamSummaryPanel({ summary, axi }: { summary: StreamSummary; axi: AxiApi }) {
  const [copied, setCopied] = useState(false)
  const copyLink = async () => {
    if (!summary.watchUrl) return
    // Main-process clipboard: navigator.clipboard fails silently here.
    if (!await axi.copyToClipboard(summary.watchUrl)) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // Hoisted so the narrowing survives into the click handlers below.
  const watchUrl = summary.watchUrl

  return (
    <div className="hero summary-panel" role="region" aria-label="Stream summary">
      <h2>Stream ended</h2>

      <div className="summary-stats">
        <div className="summary-stat">
          <span className="summary-label">Duration</span>
          <span className="summary-value mono">{formatElapsed(summary.durationMs)}</span>
        </div>
        <div className="summary-stat">
          <span className="summary-label">Average bitrate</span>
          <span className="summary-value mono">{summary.avgBitrateKbps} kbps</span>
        </div>
        {/* Each figure is judged by its own verdict: pairing the session total
            with the peak's verdict read "0.03% — viewers likely saw stuttering". */}
        <div className="summary-stat">
          <span className="summary-label">Dropped frames</span>
          <span className="summary-value mono">
            {summary.droppedPct.toFixed(2)}% — {droppedVerdict(summary.droppedPct)}
          </span>
        </div>
        <div className="summary-stat">
          <span className="summary-label">Worst moment</span>
          <span className="summary-value mono">
            {summary.peakDroppedPct.toFixed(2)}% — {droppedVerdict(summary.peakDroppedPct)}
          </span>
        </div>
      </div>

      {watchUrl ? (
        <div className="summary-actions">
          <button className="btn ghost sm" onClick={copyLink} title="Copy the YouTube watch link">
            {copied ? <><Check size={14} /> Copied!</> : <><Link size={14} /> Copy link</>}
          </button>
          {/* Through main: a renderer href to an external site opens a chrome-less
              in-app window, not the user's browser. */}
          <button className="btn ghost sm" onClick={() => void axi.openExternalUrl(watchUrl)}
            title="Open the broadcast in your browser">
            <ExternalLink size={14} /> Open on YouTube
          </button>
        </div>
      ) : null}

      {summary.recordingStillActive ? (
        <div className="summary-actions">
          <span className="muted">Still recording — the stream ended but the recording did not.</span>
          <button className="btn danger sm" onClick={() => void axi.stopRecording()}>
            <Square size={13} /> Stop recording
          </button>
        </div>
      ) : summary.recordingPath ? (
        <div className="summary-actions">
          <button className="btn ghost sm" onClick={() => void axi.openRecording(summary.recordingPath as string)}>
            <FolderOpen size={14} /> Open recording
          </button>
          {/* Selectable so a failed open still leaves something to copy. */}
          <span className="mono summary-path">{summary.recordingPath}</span>
        </div>
      ) : null}

      <button className="btn primary action" onClick={() => void axi.dismissSummary()}>Done</button>
    </div>
  )
}
