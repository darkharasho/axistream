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

describe('QualitySettings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('summarises what the stream is actually getting', () => {
    const { container } = render(<QualitySettings state={mk()} axi={axi as never} />)

    const chips = container.querySelector('.quality-chips')!
    expect(chips).toHaveTextContent('Auto')
    expect(chips).toHaveTextContent('1080p60')
    expect(chips).toHaveTextContent('9000 kbps')
    expect(chips).toHaveTextContent('NVENC')
  })

  it('says Custom once any field is overridden', () => {
    const { container } = render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, fps: 30 } })} axi={axi as never} />)

    expect(container.querySelector('.quality-chips')).toHaveTextContent('Custom')
  })

  // The eight sibling settings cards are all flat, and the grid is CSS columns
  // with break-inside: avoid — a taller card costs nothing, so the controls are
  // always visible rather than hidden behind a disclosure.
  it('shows the controls without needing to be expanded', () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)

    expect(screen.getByLabelText(/resolution/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/frame rate/i)).toBeInTheDocument()
  })

  it('omits resolutions the monitor cannot produce', async () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)

    const opts = Array.from(screen.getByLabelText(/resolution/i).querySelectorAll('option')).map((o) => o.textContent)
    expect(opts).toContain('720p')
    expect(opts).toContain('1080p')
    expect(opts.some((o) => o?.includes('1440'))).toBe(false)
  })

  it('labels Auto with the value it resolves to from the monitor, not the active override', async () => {
    render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, height: 720 }, capture: { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, outputWidth: 1280, outputHeight: 720, fps: 60 } })} axi={axi as never} />)

    const opts = Array.from(screen.getByLabelText(/resolution/i).querySelectorAll('option')).map((o) => o.textContent)
    expect(opts).toContain('Auto (1080p)')
  })

  it('shows a persisted height above the monitor as its own honest option, not a phantom Auto', async () => {
    // e.g. settings.json carries qualityHeight: 1440 from a previous, bigger
    // monitor; this one only goes up to 1080p.
    render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, height: 1440 } })} axi={axi as never} />)

    const select = screen.getByLabelText(/resolution/i) as HTMLSelectElement
    expect(select.value).toBe('1440')
    expect(select.selectedOptions[0].textContent).toMatch(/1440/)
    expect(select.selectedOptions[0].textContent?.toLowerCase()).not.toContain('auto')
  })

  it('sends the picked resolution', async () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)

    fireEvent.change(screen.getByLabelText(/resolution/i), { target: { value: '720' } })

    expect(axi.setQuality).toHaveBeenCalledWith({ height: 720 })
  })

  it('sends null when resolution goes back to Auto', async () => {
    render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, height: 720 } })} axi={axi as never} />)

    fireEvent.change(screen.getByLabelText(/resolution/i), { target: { value: 'auto' } })

    expect(axi.setQuality).toHaveBeenCalledWith({ height: null })
  })

  it('sends the picked frame rate', async () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)

    fireEvent.change(screen.getByLabelText(/frame rate/i), { target: { value: '30' } })

    expect(axi.setQuality).toHaveBeenCalledWith({ fps: 30 })
  })

  it('seeds the manual bitrate from what auto had chosen, so the box is never empty', async () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)

    await userEvent.click(screen.getByRole('checkbox', { name: /set the bitrate manually/i }))

    expect(axi.setQuality).toHaveBeenCalledWith({ bitrateKbps: 9000 })
  })

  it('hides the bitrate box until manual is ticked, and returns to auto when unticked', async () => {
    const { rerender } = render(<QualitySettings state={mk()} axi={axi as never} />)
    expect(screen.queryByLabelText(/bitrate \(kbps\)/i)).toBeNull()

    rerender(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, bitrateKbps: 4500 } })} axi={axi as never} />)
    expect(screen.getByLabelText(/bitrate \(kbps\)/i)).toHaveValue(4500)

    await userEvent.click(screen.getByRole('checkbox', { name: /set the bitrate manually/i }))
    expect(axi.setQuality).toHaveBeenCalledWith({ bitrateKbps: null })
  })

  it('does not fire setQuality while the bitrate field is mid-edit', async () => {
    render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, bitrateKbps: 9000 } })} axi={axi as never} />)

    const input = screen.getByLabelText(/bitrate \(kbps\)/i)
    await userEvent.tripleClick(input)
    await userEvent.keyboard('3')

    expect(axi.setQuality).not.toHaveBeenCalled()
    expect(input).toHaveValue(3)
  })

  it('commits the typed bitrate once, on blur', async () => {
    render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, bitrateKbps: 9000 } })} axi={axi as never} />)

    const input = screen.getByLabelText(/bitrate \(kbps\)/i)
    await userEvent.tripleClick(input)
    await userEvent.keyboard('3000')
    input.blur()

    expect(axi.setQuality).toHaveBeenCalledTimes(1)
    expect(axi.setQuality).toHaveBeenCalledWith({ bitrateKbps: 3000 })
  })

  it('commits the typed bitrate on Enter', async () => {
    render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, bitrateKbps: 9000 } })} axi={axi as never} />)

    const input = screen.getByLabelText(/bitrate \(kbps\)/i)
    await userEvent.tripleClick(input)
    await userEvent.keyboard('4200{Enter}')

    expect(axi.setQuality).toHaveBeenCalledTimes(1)
    expect(axi.setQuality).toHaveBeenCalledWith({ bitrateKbps: 4200 })
  })

  it('re-syncs the local bitrate value when the prop changes and the field is not focused', async () => {
    const { rerender } = render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, bitrateKbps: 9000 } })} axi={axi as never} />)

    expect(screen.getByLabelText(/bitrate \(kbps\)/i)).toHaveValue(9000)

    rerender(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, bitrateKbps: 5000 } })} axi={axi as never} />)

    expect(screen.getByLabelText(/bitrate \(kbps\)/i)).toHaveValue(5000)
  })

  it('lists every OBS encoder row', () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)

    expect(screen.getByLabelText('Encoder')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Hardware \(NVENC, AV1\)/ })).toBeInTheDocument()
  })

  it('sends the picked encoder', async () => {
    render(<QualitySettings state={mk({ gpuVendor: 'nvidia' })} axi={axi as never} />)

    fireEvent.change(screen.getByLabelText('Encoder'), { target: { value: 'nvenc_h264' } })

    expect(axi.setQuality).toHaveBeenCalledWith({ encoder: 'nvenc_h264' })
  })

  it('disables AV1 and HEVC with the ingest reason', () => {
    render(<QualitySettings state={mk({ gpuVendor: 'nvidia' })} axi={axi as never} />)

    const av1 = screen.getByRole('option', { name: /Hardware \(NVENC, AV1\)/ }) as HTMLOptionElement
    expect(av1.disabled).toBe(true)
    expect(av1.textContent).toMatch(/enhanced RTMP/)
  })

  it('keeps a stale selection visible instead of silently showing another row', () => {
    // Same principle as phantomHeight: a persisted choice that no longer
    // applies is surfaced, not hidden behind a value the user never picked.
    render(<QualitySettings state={mk({ gpuVendor: 'amd-intel', quality: { ...DEFAULT_QUALITY, encoder: 'nvenc_av1' } })} axi={axi as never} />)

    const sel = screen.getByLabelText('Encoder') as HTMLSelectElement
    expect(sel.value).toBe('nvenc_av1')
  })

  it('explains an encoder the app chose after a failed go-live', () => {
    render(<QualitySettings state={mk({ quality: { ...DEFAULT_QUALITY, encoder: 'x264', encoderAuto: true } })} axi={axi as never} />)

    expect(screen.getByText(/switched to software encoding/)).toBeInTheDocument()
  })

  it('no longer offers the software-encoding checkbox', () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)

    expect(screen.queryByLabelText('Software encoding')).toBeNull()
  })

  it('stays editable while live, but says the change is deferred', () => {
    render(<QualitySettings state={mk({ phase: 'LIVE' })} axi={axi as never} />)

    expect(screen.getByText(/applies to your next stream/i)).toBeInTheDocument()
  })

  // Regression: main's setQuality handler defers to the next stream for
  // GOING_LIVE and STARTING_ON_YOUTUBE too (OBS is already streaming), so the
  // panel must agree — both derive from the same isStreamingPhase predicate.
  it.each(['GOING_LIVE', 'STARTING_ON_YOUTUBE', 'RECONNECTING'] as const)(
    'also says deferred during %s, matching main\'s live guard',
    (phase) => {
      render(<QualitySettings state={mk({ phase })} axi={axi as never} />)

      expect(screen.getByText(/applies to your next stream/i)).toBeInTheDocument()
    },
  )

  it('says nothing about deferral when not live', () => {
    render(<QualitySettings state={mk()} axi={axi as never} />)

    expect(screen.queryByText(/applies to your next stream/i)).toBeNull()
  })
})
