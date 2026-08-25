import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StreamScreen } from '../src/renderer/components/StreamScreen.js'
import type { AppState } from '../src/shared/state.js'

const base: AppState = { phase: 'READY', capture: { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, outputWidth: 1920, outputHeight: 1080, fps: 60 }, captureTargets: [], stats: null, liveUnconfirmed: false, error: null, encoder: 'x264',
  videoBitrateKbps: null, youtube: { connected: false, channel: null }, settings: { titleTemplate: '', dateFormat: 'YYYY-MM-DD', privacy: 'public', discordWebhookUrl: '', discordMessage: '', recordDir: '' }, audio: { desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }, masks: [], gameAudioPlugin: { status: 'missing', error: null }, blurPlugin: { status: 'missing', error: null }, maskStyle: 'box', ptt: { available: false, enabled: false, active: false, error: null, mode: null, keyName: 'F18', keyCode: 188, modifier: null }, windowFitted: false, masksVisible: true, watchUrl: null, webcam: { enabled: false, deviceId: null, deviceLabel: null, corner: 'br', sizePct: 0.22, mirrored: false, mode: null, available: true }, recording: { active: false, startedAt: null, dir: '', lastPath: null, error: null }, audioTestActive: false, summary: null }
const axi = { provision: vi.fn(), getCaptureTargets: vi.fn(), cancelCaptureSelection: vi.fn(), goLive: vi.fn(), stopStream: vi.fn(), repairCapture: vi.fn(), switchSource: vi.fn(), getInitialState: vi.fn(async () => base), setMasks: vi.fn(), setMaskStyle: vi.fn(), installBlurPlugin: vi.fn(), relaunchApp: vi.fn(), fitWindowToCapture: vi.fn(), setMasksVisible: vi.fn(), connectYouTube: vi.fn(), copyToClipboard: vi.fn(async () => true) }
const store = { applyState: vi.fn() }

describe('StreamScreen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('SETTING_UP shows the setup CTA', () => {
    render(<StreamScreen state={{ ...base, phase: 'SETTING_UP', capture: null }} preview={null} axi={axi as any} store={store as any} />)
    expect(screen.getByRole('button', { name: /set up capture/i })).toBeInTheDocument()
  })

  it('disables setup immediately and ignores a duplicate click while the request is pending', async () => {
    let release!: () => void
    axi.provision.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve }))
    render(<StreamScreen state={{ ...base, phase: 'SETTING_UP', capture: null }} preview={null} axi={axi as any} store={store as any} />)
    const button = screen.getByRole('button', { name: /set up capture/i })

    fireEvent.click(button)
    fireEvent.click(button)

    expect(axi.provision).toHaveBeenCalledOnce()
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent(/preparing capture/i)
    release()
    await waitFor(() => expect(button).toBeEnabled())
  })

  it('shows truthful progress while the owned runtime is preparing', () => {
    render(<StreamScreen state={{ ...base, phase: 'PREPARING_CAPTURE', capture: null }} preview={null} axi={axi as any} store={store as any} />)
    expect(screen.getByRole('button', { name: /preparing capture/i })).toBeDisabled()
  })

  it('renders monitor choices and forwards the exact selected option', () => {
    const options = [
      { property: 'monitor_id', value: '{LEFT}', label: 'Left monitor' },
      { property: 'monitor_id', value: '{RIGHT}', label: 'Right monitor' },
    ]
    render(<StreamScreen state={{ ...base, phase: 'CHOOSING_CAPTURE', capture: null, captureTargets: options }} preview={null} axi={axi as any} store={store as any} />)

    fireEvent.click(screen.getByRole('button', { name: 'Right monitor' }))

    expect(axi.provision).toHaveBeenCalledWith(options[1])
  })

  it('lets the user cancel monitor selection', () => {
    render(<StreamScreen state={{
      ...base, phase: 'CHOOSING_CAPTURE', capture: null,
      captureTargets: [{ property: 'monitor_id', value: '{LEFT}', label: 'Left monitor' }],
    }} preview={null} axi={axi as any} store={store as any} />)

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(axi.cancelCaptureSelection).toHaveBeenCalledOnce()
  })

  it('shows the actual setup error and retries from the same panel', () => {
    render(<StreamScreen state={{ ...base, phase: 'ERROR', capture: null, error: 'No usable displays were reported by OBS' }} preview={null} axi={axi as any} store={store as any} />)
    expect(screen.getByText('No usable displays were reported by OBS')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /retry setup/i }))

    expect(axi.provision).toHaveBeenCalledOnce()
  })

  it('NEEDS_YOUTUBE shows the Connect YouTube button, not Go Live', () => {
    render(<StreamScreen state={{ ...base, phase: 'NEEDS_YOUTUBE' }} preview={null} axi={axi as any} store={store as any} />)
    expect(screen.getByRole('button', { name: /connect youtube to go live/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^go live$/i })).not.toBeInTheDocument()
  })

  it('READY shows an enabled Go Live', () => {
    render(<StreamScreen state={base} preview={null} axi={axi as any} store={store as any} />)
    const btn = screen.getByRole('button', { name: /go live/i })
    expect(btn).toBeEnabled()
  })

  it('Switch source kicks the portal (switchSource), not full re-setup', () => {
    render(<StreamScreen state={base} preview={null} axi={axi as any} store={store as any} />)
    fireEvent.click(screen.getByRole('button', { name: /switch source/i }))
    expect(axi.switchSource).toHaveBeenCalledOnce()
    expect(axi.repairCapture).not.toHaveBeenCalled()
  })

  it('Copy link copies the watch URL via the main-process clipboard, not navigator.clipboard', async () => {
    render(<StreamScreen state={{ ...base, phase: 'LIVE', watchUrl: 'https://www.youtube.com/watch?v=abc123' }} preview={null} axi={axi as any} store={store as any} />)

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))

    expect(axi.copyToClipboard).toHaveBeenCalledWith('https://www.youtube.com/watch?v=abc123')
    await waitFor(() => expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument())
  })

  it('LIVE shows End Stream and the LIVE badge', () => {
    render(<StreamScreen state={{ ...base, phase: 'LIVE', stats: { bitrateKbps: 5980, droppedFrames: 0, droppedPct: 0, durationMs: 767000, encoder: 'x264', cpuPct: 11, reconnecting: false } }} preview={null} axi={axi as any} store={store as any} />)
    expect(screen.getByRole('button', { name: /end stream/i })).toBeInTheDocument()
    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })
})


describe('StreamScreen fit label', () => {
  it("says Fit when unfitted and Unfit when the window matches the game's aspect", () => {
    const { rerender } = render(<StreamScreen state={{ ...base, windowFitted: false }} preview={null} axi={axi as never} store={store as never} />)
    expect(screen.getByRole('button', { name: /fit/i })).toHaveTextContent('Fit')
    rerender(<StreamScreen state={{ ...base, windowFitted: true }} preview={null} axi={axi as never} store={store as never} />)
    expect(screen.getByRole('button', { name: /unfit/i })).toBeInTheDocument()
  })
})

const summary = {
  durationMs: 5_400_000, avgBitrateKbps: 6000, peakDroppedPct: 0.02, droppedFrames: 12,
  droppedPct: 0.02, encoder: 'NVENC H.264', watchUrl: 'https://youtu.be/abc',
  recordingPath: null, recordingStillActive: false, endedWithError: false,
}

describe('StreamScreen ENDED phase', () => {
  it('mounts the summary panel instead of the stream hero', () => {
    render(<StreamScreen state={{ ...base, phase: 'ENDED', summary }} preview={null} axi={axi as never} store={store as never} />)

    expect(screen.getByRole('region', { name: /stream summary/i })).toBeInTheDocument()
    expect(screen.getByText(/stream ended/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument()
    // The hero's live controls are gone while the summary is up.
    expect(screen.queryByRole('button', { name: /go live/i })).toBeNull()
  })

  it('falls back to the stream hero when ENDED arrives without a summary', () => {
    render(<StreamScreen state={{ ...base, phase: 'ENDED', summary: null }} preview={null} axi={axi as never} store={store as never} />)

    expect(screen.queryByRole('region', { name: /stream summary/i })).toBeNull()
    expect(screen.getByRole('button', { name: /go live/i })).toBeInTheDocument()
  })
})

describe('StreamScreen record button', () => {
  it('mounts an enabled Record button while nothing owns the recorder', () => {
    render(<StreamScreen state={base} preview={null} axi={axi as never} store={store as never} />)
    expect(screen.getByRole('button', { name: /^record$/i })).toBeEnabled()
  })

  it('disables Record while the audio test owns the single record output', () => {
    render(<StreamScreen state={{ ...base, audioTestActive: true }} preview={null} axi={axi as never} store={store as never} />)
    const btn = screen.getByRole('button', { name: /^record$/i })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', expect.stringMatching(/audio test/i))
  })
})
