import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AudioSettings } from '../src/renderer/components/AudioSettings.js'

const axi = {
  getAudioDevices: vi.fn(async () => [{ id: 'default', name: 'Default' }, { id: 'yeti', name: 'Yeti' }]),
  getDesktopDevices: vi.fn(async () => [{ id: 'default', name: 'Default' }, { id: 'hdmi', name: 'HDMI' }]),
  setDesktopEnabled: vi.fn(async () => {}),
  setDesktopDevice: vi.fn(async () => {}),
  setMicEnabled: vi.fn(async () => {}),
  setMicDevice: vi.fn(async () => {}),
  setGameAudioApps: vi.fn(async () => {}),
  getGameAudioApps: vi.fn(async () => [{ id: 'gw2-64.exe', name: 'Guild Wars 2' }, { id: 'Discord', name: 'Discord' }]),
}
beforeEach(() => { (globalThis as any).axi = axi; vi.clearAllMocks() })

const pluginReady = { status: 'ready' as any, error: null }

describe('AudioSettings', () => {
  it('toggles desktop audio', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" />)
    fireEvent.click(screen.getByLabelText(/desktop audio/i))
    expect(axi.setDesktopEnabled).toHaveBeenCalledWith(false)
    await screen.findByLabelText('Guild Wars 2')
  })

  it('toggles mic and shows a populated device picker', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" />)
    expect(axi.getAudioDevices).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('option', { name: 'Yeti' })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/microphone device/i), { target: { value: 'yeti' } })
    expect(axi.setMicDevice).toHaveBeenCalledWith('yeti')
  })

  it('does not query devices when mic is off', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" />)
    expect(axi.getAudioDevices).not.toHaveBeenCalled()
    await screen.findByLabelText('Guild Wars 2')
  })

  it('populates the output dropdown when desktop audio is on and selection calls setDesktopDevice', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" />)
    expect(axi.getDesktopDevices).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('option', { name: 'HDMI' })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/output device/i), { target: { value: 'hdmi' } })
    expect(axi.setDesktopDevice).toHaveBeenCalledWith('hdmi')
    await screen.findByLabelText('Guild Wars 2')
  })

  it('does not query output devices when desktop audio is off', async () => {
    render(<AudioSettings audio={{ desktopEnabled: false, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" />)
    expect(axi.getDesktopDevices).not.toHaveBeenCalled()
    await screen.findByLabelText('Guild Wars 2')
  })

  it('renders an unavailable placeholder when the saved output device is not enumerated', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: 'unplugged-dac', micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" />)
    expect(await screen.findByText('Saved device (unavailable)')).toBeInTheDocument()
    const select = screen.getByLabelText(/output device/i) as HTMLSelectElement
    expect(select.value).toBe('unplugged-dac')
    await screen.findByLabelText('Guild Wars 2')
  })

  it('renders an unavailable placeholder when the saved mic device is not enumerated', async () => {
    render(<AudioSettings audio={{ desktopEnabled: false, desktopDevice: null, micEnabled: true, micDevice: 'unplugged-mic', gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" />)
    expect(await screen.findByText('Saved device (unavailable)')).toBeInTheDocument()
    const select = screen.getByLabelText(/microphone device/i) as HTMLSelectElement
    expect(select.value).toBe('unplugged-mic')
    await screen.findByLabelText('Guild Wars 2')
  })

  it('never flashes the unavailable placeholder while devices are still enumerating', async () => {
    // The saved device IS in the list, but the list resolves late — the
    // placeholder must not appear in the pre-resolution render.
    let resolveDevices: (d: { id: string; name: string }[]) => void = () => {}
    axi.getDesktopDevices.mockImplementationOnce(() => new Promise((r) => { resolveDevices = r }))
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: 'hdmi', micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" />)
    expect(screen.queryByText('Saved device (unavailable)')).toBeNull()
    resolveDevices([{ id: 'hdmi', name: 'HDMI' }])
    await waitFor(() => expect(screen.getByRole('option', { name: 'HDMI' })).toBeInTheDocument())
    expect(screen.queryByText('Saved device (unavailable)')).toBeNull()
    await screen.findByLabelText('Guild Wars 2')
  })

  it('checking an app calls setGameAudioApps with the union', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" />)
    fireEvent.click(await screen.findByLabelText('Guild Wars 2'))
    expect(axi.setGameAudioApps).toHaveBeenCalledWith(['gw2-64.exe'])
  })

  it('unchecking an app calls setGameAudioApps without it', async () => {
    render(<AudioSettings audio={{ desktopEnabled: false, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: ['gw2-64.exe', 'Discord'] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" />)
    fireEvent.click(await screen.findByLabelText('Guild Wars 2'))
    expect(axi.setGameAudioApps).toHaveBeenCalledWith(['Discord'])
  })

  it('checking All desktop audio while apps are selected still just calls setDesktopEnabled(true)', async () => {
    render(<AudioSettings audio={{ desktopEnabled: false, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: ['gw2-64.exe'] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" />)
    await screen.findByLabelText('Guild Wars 2')
    fireEvent.click(screen.getByLabelText('All desktop audio'))
    expect(axi.setDesktopEnabled).toHaveBeenCalledWith(true)
  })

  it('saved app absent from the running list shows the not-running pill', async () => {
    axi.getGameAudioApps.mockResolvedValueOnce([{ id: 'Discord', name: 'Discord' }])
    render(<AudioSettings audio={{ desktopEnabled: false, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: ['closed-game.exe'] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" />)
    expect(await screen.findByText('not running')).toBeInTheDocument()
    expect(screen.getByLabelText('closed-game.exe')).toBeChecked()
  })

  it('two rapid toggles (no await between) send the full combined selection in the second call', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" />)
    await screen.findByLabelText('Guild Wars 2')
    fireEvent.click(screen.getByLabelText('Guild Wars 2'))
    fireEvent.click(screen.getByLabelText('Discord'))
    expect(axi.setGameAudioApps).toHaveBeenCalledTimes(2)
    expect(axi.setGameAudioApps).toHaveBeenLastCalledWith(['gw2-64.exe', 'Discord'])
  })

  it('refresh re-enumerates', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" />)
    await screen.findByLabelText('Guild Wars 2')
    fireEvent.click(screen.getByTitle('Refresh running apps'))
    expect(axi.getGameAudioApps).toHaveBeenCalledTimes(2)
    // Flush the second getGameAudioApps resolution
    await screen.findByLabelText('Guild Wars 2')
  })

  it('plugin not ready: no app rows, install flow renders instead', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={{ status: 'missing', error: null }} phase="READY" />)
    expect(axi.getGameAudioApps).not.toHaveBeenCalled()
    expect(screen.getByText('Install plugin')).toBeInTheDocument()
    await screen.findByRole('option', { name: 'Default' })
  })
})

describe('AudioSettings app search', () => {
  const ready = { status: 'ready' as const, error: null }
  const base = { desktopEnabled: false, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }

  it('filters app rows by substring, case-insensitive', async () => {
    axi.getGameAudioApps.mockResolvedValueOnce([
      { id: 'gw2-64.exe', name: 'Guild Wars 2' },
      { id: 'Discord', name: 'Discord' },
    ])
    render(<AudioSettings audio={base} gameAudioPlugin={ready} phase="READY" />)
    await screen.findByLabelText('Guild Wars 2')
    fireEvent.change(screen.getByLabelText('Search apps'), { target: { value: 'guild' } })
    expect(screen.getByLabelText('Guild Wars 2')).toBeInTheDocument()
    expect(screen.queryByLabelText('Discord')).toBeNull()
    fireEvent.change(screen.getByLabelText('Search apps'), { target: { value: '' } })
    expect(await screen.findByLabelText('Discord')).toBeInTheDocument()
  })
})
