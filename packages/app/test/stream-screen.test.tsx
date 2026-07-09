import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StreamScreen } from '../src/renderer/components/StreamScreen.js'
import type { AppState } from '../src/shared/state.js'

const base: AppState = { phase: 'READY', capture: { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, outputWidth: 1920, outputHeight: 1080, fps: 60 }, stats: null, liveUnconfirmed: false, error: null, encoder: 'x264',
  videoBitrateKbps: null, youtube: { connected: false, channel: null }, settings: { titleTemplate: '', dateFormat: 'YYYY-MM-DD', privacy: 'public', discordWebhookUrl: '', discordMessage: '' }, audio: { desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }, masks: [], gameAudioPlugin: { status: 'missing', error: null }, blurPlugin: { status: 'missing', error: null }, maskStyle: 'box', ptt: { available: false, enabled: false, active: false, error: null, mode: null, keyName: 'F18', keyCode: 188, modifier: null }, windowFitted: false, masksVisible: true }
const axi = { provision: vi.fn(), goLive: vi.fn(), stopStream: vi.fn(), repairCapture: vi.fn(), switchSource: vi.fn(), getInitialState: vi.fn(async () => base), setMasks: vi.fn(), setMaskStyle: vi.fn(), installBlurPlugin: vi.fn(), relaunchApp: vi.fn(), fitWindowToCapture: vi.fn(), setMasksVisible: vi.fn(), connectYouTube: vi.fn() }
const store = { applyState: vi.fn() }

describe('StreamScreen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('SETTING_UP shows the setup CTA', () => {
    render(<StreamScreen state={{ ...base, phase: 'SETTING_UP', capture: null }} preview={null} axi={axi as any} store={store as any} />)
    expect(screen.getByRole('button', { name: /set up capture/i })).toBeInTheDocument()
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
