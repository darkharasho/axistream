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

/** The tile whose key matches `label`, read back as its three parts. */
const tile = (container: HTMLElement, label: RegExp) => {
  const stat = [...container.querySelectorAll('.axi-stat')]
    .find((el) => label.test(el.querySelector('.axi-stat__k')!.textContent ?? ''))!
  return {
    n: stat.querySelector('.axi-stat__n')!.textContent,
    verdict: stat.querySelector('.summary-verdict')!.textContent,
  }
}

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
    // peak's verdict. Asserted per tile rather than per string, because the
    // figure and its verdict now sit in sibling elements.
    const { container } = render(<StreamSummaryPanel summary={{ ...base, droppedPct: 0.03, peakDroppedPct: 4 }} axi={api()} />)

    expect(tile(container, /dropped frames/i)).toMatchObject({ n: '0.03%', verdict: 'clean' })
    expect(tile(container, /worst moment/i)).toMatchObject({ n: '4.00%', verdict: 'viewers likely saw stuttering' })
  })

  it('draws the figure as the number and the label beneath it', () => {
    // .axi-stat__n is --axi-t-h1 (900 30px/1.1) and .axi-stat__k carries a
    // margin-top on the assumption it sits UNDER its number. Rendering the key
    // first set every label in display type and pushed the gap to the wrong
    // side of the pair.
    const { container } = render(<StreamSummaryPanel summary={base} axi={api()} />)

    for (const stat of container.querySelectorAll('.axi-stat')) {
      expect(stat.children[0]!.className).toContain('axi-stat__n')
      expect(stat.children[1]!.className).toContain('axi-stat__k')
    }
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

  it('suppresses the watch link when the stream ended with an error', () => {
    render(<StreamSummaryPanel summary={{ ...base, watchUrl: 'https://youtu.be/abc', endedWithError: true }} axi={api()} />)

    expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /open on youtube/i })).toBeNull()
  })

  it('reports dropped frames as a plain count and names the encoder', () => {
    render(<StreamSummaryPanel summary={{ ...base, droppedFrames: 412 }} axi={api()} />)

    expect(screen.getByText(/Dropped frames · 412/)).toBeTruthy()
    expect(screen.getByText('NVENC H.264')).toBeTruthy()
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
