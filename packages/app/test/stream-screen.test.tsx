import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StreamScreen } from '../src/renderer/components/StreamScreen.js'
import type { AppState } from '../src/shared/state.js'

const base: AppState = { phase: 'READY', capture: { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, outputWidth: 1920, outputHeight: 1080, fps: 60 }, keyMasked: '····7f3a', stats: null, error: null, youtube: { connected: false, channel: null }, settings: { titleTemplate: '', dateFormat: 'YYYY-MM-DD', privacy: 'public' } }
const axi = { provision: vi.fn(), saveKey: vi.fn(), forgetKey: vi.fn(), goLive: vi.fn(), stopStream: vi.fn(), repairCapture: vi.fn(), switchSource: vi.fn(), getInitialState: vi.fn(async () => base) }
const store = { applyState: vi.fn() }

describe('StreamScreen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('SETTING_UP shows the setup CTA', () => {
    render(<StreamScreen state={{ ...base, phase: 'SETTING_UP', capture: null, keyMasked: null }} preview={null} axi={axi as any} store={store as any} />)
    expect(screen.getByRole('button', { name: /set up capture/i })).toBeInTheDocument()
  })

  it('NEEDS_KEY shows the key input, not Go Live', () => {
    render(<StreamScreen state={{ ...base, phase: 'NEEDS_KEY', keyMasked: null }} preview={null} axi={axi as any} store={store as any} />)
    expect(screen.getByPlaceholderText(/stream key/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /go live/i })).not.toBeInTheDocument()
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
    render(<StreamScreen state={{ ...base, phase: 'LIVE', stats: { bitrateKbps: 5980, droppedFrames: 0, durationMs: 767000, encoder: 'x264', cpuPct: 11, reconnecting: false } }} preview={null} axi={axi as any} store={store as any} />)
    expect(screen.getByRole('button', { name: /end stream/i })).toBeInTheDocument()
    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })
})
