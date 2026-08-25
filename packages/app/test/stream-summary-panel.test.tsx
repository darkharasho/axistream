import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StreamSummaryPanel, droppedVerdict } from '../src/renderer/components/StreamSummaryPanel.js'
import type { StreamSummary } from '../src/shared/state.js'

const base: StreamSummary = {
  durationMs: 5_400_000, avgBitrateKbps: 6000, peakDroppedPct: 0.02, droppedFrames: 12,
  droppedPct: 0.02, encoder: 'NVENC H.264', watchUrl: null,
  recordingPath: null, recordingStillActive: false, endedWithError: false,
}

const api = (over: Record<string, any> = {}) => ({
  copyToClipboard: vi.fn(async () => true),
  openExternalUrl: vi.fn(async () => true),
  openRecording: vi.fn(async () => ({ ok: true })),
  stopRecording: vi.fn(async () => ({ ok: true, outputPath: '/home/u/v.mp4' })),
  dismissSummary: vi.fn(async () => {}),
  ...over,
}) as any

describe('droppedVerdict', () => {
  it('calls a clean stream clean', () => {
    expect(droppedVerdict(0.02)).toMatch(/clean/i)
  })

  it('warns when viewers would have seen it', () => {
    expect(droppedVerdict(3.1)).toMatch(/stuttering/i)
  })
})

describe('StreamSummaryPanel', () => {
  it('reports duration and average bitrate', () => {
    render(<StreamSummaryPanel summary={base} axi={api()} />)

    expect(screen.getByText('1:30:00')).toBeTruthy()
    expect(screen.getByText(/6000 kbps/i)).toBeTruthy()
  })

  it('judges each dropped-frame figure by its own number', () => {
    // A recovered 4% spike in an otherwise clean stream used to render
    // "0.03% — viewers likely saw stuttering": the session total beside the
    // peak's verdict.
    render(<StreamSummaryPanel summary={{ ...base, droppedPct: 0.03, peakDroppedPct: 4 }} axi={api()} />)

    expect(screen.getByText(/0\.03% — clean/)).toBeTruthy()
    expect(screen.getByText(/4\.00% — viewers likely saw stuttering/)).toBeTruthy()
  })

  it('omits the watch link entirely when there is no watch url', () => {
    render(<StreamSummaryPanel summary={base} axi={api()} />)

    expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull()
  })

  it('copies the watch link through the main-process clipboard', async () => {
    const axi = api()
    render(<StreamSummaryPanel summary={{ ...base, watchUrl: 'https://youtu.be/abc' }} axi={axi} />)

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))

    expect(axi.copyToClipboard).toHaveBeenCalledWith('https://youtu.be/abc')
    await screen.findByText(/copied/i)
  })

  it('opens the broadcast through main, never as a renderer href', () => {
    const axi = api()
    const { container } = render(<StreamSummaryPanel summary={{ ...base, watchUrl: 'https://youtu.be/abc' }} axi={axi} />)

    // An href here would open a chrome-less in-app window with the app's
    // webPreferences instead of the user's browser.
    expect(container.querySelector('a[href]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /open on youtube/i }))

    expect(axi.openExternalUrl).toHaveBeenCalledWith('https://youtu.be/abc')
  })

  it('omits the recording block when no recording happened', () => {
    render(<StreamSummaryPanel summary={base} axi={api()} />)

    expect(screen.queryByRole('button', { name: /open recording/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /stop recording/i })).toBeNull()
  })

  it('opens a recording that finished during the stream', () => {
    const axi = api()
    render(<StreamSummaryPanel summary={{ ...base, recordingPath: '/home/u/v.mp4' }} axi={axi} />)

    fireEvent.click(screen.getByRole('button', { name: /open recording/i }))

    expect(axi.openRecording).toHaveBeenCalledWith('/home/u/v.mp4')
  })

  it('offers to stop a recording still running at stream end', () => {
    const axi = api()
    render(<StreamSummaryPanel summary={{ ...base, recordingStillActive: true }} axi={axi} />)

    expect(screen.getByText(/still recording/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /stop recording/i }))

    expect(axi.stopRecording).toHaveBeenCalled()
  })

  it('dismisses', () => {
    const axi = api()
    render(<StreamSummaryPanel summary={base} axi={axi} />)

    fireEvent.click(screen.getByRole('button', { name: /done/i }))

    expect(axi.dismissSummary).toHaveBeenCalled()
  })
})
