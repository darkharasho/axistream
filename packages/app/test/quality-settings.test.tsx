import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QualitySettings } from '../src/renderer/components/QualitySettings.js'
import { INITIAL_STATE, DEFAULT_QUALITY, type AppState } from '../src/shared/state.js'

const axi = { setQuality: vi.fn(async () => {}) }

const mk = (over: Partial<AppState> = {}): AppState => ({
  ...INITIAL_STATE,
  phase: 'READY',
  encoder: 'NVENC',
  videoBitrateKbps: 9000,
  capture: { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, outputWidth: 1920, outputHeight: 1080, fps: 60 },
  quality: { ...DEFAULT_QUALITY },
  ...over,
})

const expand = async () => { await userEvent.click(screen.getByRole('button', { name: /quality/i })) }

describe('QualitySettings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('summarises what the stream is actually getting, without expanding', () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)

    const header = screen.getByRole('button', { name: /quality/i })
    expect(header).toHaveTextContent('Auto')
    expect(header).toHaveTextContent('1080p60')
    expect(header).toHaveTextContent('9000 kbps')
    expect(header).toHaveTextContent('NVENC')
    expect(screen.queryByLabelText(/resolution/i)).toBeNull()
  })

  it('says Custom once any field is overridden', () => {
    render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, fps: 30 } })} axi={axi as never} />)

    expect(screen.getByRole('button', { name: /quality/i })).toHaveTextContent('Custom')
  })

  it('omits resolutions the monitor cannot produce', async () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)
    await expand()

    const opts = Array.from(screen.getByLabelText(/resolution/i).querySelectorAll('option')).map((o) => o.textContent)
    expect(opts).toContain('720p')
    expect(opts).toContain('1080p')
    expect(opts.some((o) => o?.includes('1440'))).toBe(false)
  })

  it('labels Auto with the value it resolves to from the monitor, not the active override', async () => {
    render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, height: 720 }, capture: { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, outputWidth: 1280, outputHeight: 720, fps: 60 } })} axi={axi as never} />)
    await expand()

    const opts = Array.from(screen.getByLabelText(/resolution/i).querySelectorAll('option')).map((o) => o.textContent)
    expect(opts).toContain('Auto (1080p)')
  })

  it('sends the picked resolution', async () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)
    await expand()

    fireEvent.change(screen.getByLabelText(/resolution/i), { target: { value: '720' } })

    expect(axi.setQuality).toHaveBeenCalledWith({ height: 720 })
  })

  it('sends null when resolution goes back to Auto', async () => {
    render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, height: 720 } })} axi={axi as never} />)
    await expand()

    fireEvent.change(screen.getByLabelText(/resolution/i), { target: { value: 'auto' } })

    expect(axi.setQuality).toHaveBeenCalledWith({ height: null })
  })

  it('sends the picked frame rate', async () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)
    await expand()

    fireEvent.change(screen.getByLabelText(/frame rate/i), { target: { value: '30' } })

    expect(axi.setQuality).toHaveBeenCalledWith({ fps: 30 })
  })

  it('seeds the manual bitrate from what auto had chosen, so the box is never empty', async () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)
    await expand()

    await userEvent.click(screen.getByRole('checkbox', { name: /set the bitrate manually/i }))

    expect(axi.setQuality).toHaveBeenCalledWith({ bitrateKbps: 9000 })
  })

  it('hides the bitrate box until manual is ticked, and returns to auto when unticked', async () => {
    const { rerender } = render(<QualitySettings state={mk()} axi={axi as never} />)
    await expand()
    expect(screen.queryByLabelText(/bitrate \(kbps\)/i)).toBeNull()

    rerender(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, bitrateKbps: 4500 } })} axi={axi as never} />)
    expect(screen.getByLabelText(/bitrate \(kbps\)/i)).toHaveValue(4500)

    await userEvent.click(screen.getByRole('checkbox', { name: /set the bitrate manually/i }))
    expect(axi.setQuality).toHaveBeenCalledWith({ bitrateKbps: null })
  })

  it('toggles software encoding', async () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)
    await expand()

    await userEvent.click(screen.getByRole('checkbox', { name: /software encoding/i }))

    expect(axi.setQuality).toHaveBeenCalledWith({ preferSoftware: true })
  })

  it('explains a software fallback the app chose, not the user', async () => {
    render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, preferSoftware: true, preferSoftwareAuto: true } })} axi={axi as never} />)
    await expand()

    expect(screen.getByText(/switched to software encoding after a stream failed/i)).toBeInTheDocument()
  })

  it('gives the generic explanation when the user ticked it themselves', async () => {
    render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, preferSoftware: true, preferSoftwareAuto: false } })} axi={axi as never} />)
    await expand()

    expect(screen.queryByText(/switched to software encoding after a stream failed/i)).toBeNull()
    expect(screen.getByText(/use the cpu instead of your graphics card/i)).toBeInTheDocument()
  })

  it('stays editable while live, but says the change is deferred', () => {
    render(<QualitySettings state={mk({ phase: 'LIVE' })} axi={axi as never} />)

    expect(screen.getByText(/applies to your next stream/i)).toBeInTheDocument()
  })

  it('says nothing about deferral when not live', () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)

    expect(screen.queryByText(/applies to your next stream/i)).toBeNull()
  })
})
