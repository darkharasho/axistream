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
}
beforeEach(() => { (globalThis as any).axi = axi; vi.clearAllMocks() })

describe('AudioSettings', () => {
  it('toggles desktop audio', () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} />)
    fireEvent.click(screen.getByLabelText(/desktop audio/i))
    expect(axi.setDesktopEnabled).toHaveBeenCalledWith(false)
  })

  it('toggles mic and shows a populated device picker', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} />)
    expect(axi.getAudioDevices).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('option', { name: 'Yeti' })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/microphone device/i), { target: { value: 'yeti' } })
    expect(axi.setMicDevice).toHaveBeenCalledWith('yeti')
  })

  it('does not query devices when mic is off', () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} />)
    expect(axi.getAudioDevices).not.toHaveBeenCalled()
  })

  it('populates the output dropdown when desktop audio is on and selection calls setDesktopDevice', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} />)
    expect(axi.getDesktopDevices).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('option', { name: 'HDMI' })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/output device/i), { target: { value: 'hdmi' } })
    expect(axi.setDesktopDevice).toHaveBeenCalledWith('hdmi')
  })

  it('does not query output devices when desktop audio is off', () => {
    render(<AudioSettings audio={{ desktopEnabled: false, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} />)
    expect(axi.getDesktopDevices).not.toHaveBeenCalled()
  })

  it('renders an unavailable placeholder when the saved output device is not enumerated', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: 'unplugged-dac', micEnabled: false, micDevice: null, gameAudioApps: [] }} />)
    expect(await screen.findByText('Saved device (unavailable)')).toBeInTheDocument()
    const select = screen.getByLabelText(/output device/i) as HTMLSelectElement
    expect(select.value).toBe('unplugged-dac')
  })

  it('renders an unavailable placeholder when the saved mic device is not enumerated', async () => {
    render(<AudioSettings audio={{ desktopEnabled: false, desktopDevice: null, micEnabled: true, micDevice: 'unplugged-mic', gameAudioApps: [] }} />)
    expect(await screen.findByText('Saved device (unavailable)')).toBeInTheDocument()
    const select = screen.getByLabelText(/microphone device/i) as HTMLSelectElement
    expect(select.value).toBe('unplugged-mic')
  })

  it('never flashes the unavailable placeholder while devices are still enumerating', async () => {
    // The saved device IS in the list, but the list resolves late — the
    // placeholder must not appear in the pre-resolution render.
    let resolveDevices: (d: { id: string; name: string }[]) => void = () => {}
    axi.getDesktopDevices.mockImplementationOnce(() => new Promise((r) => { resolveDevices = r }))
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: 'hdmi', micEnabled: false, micDevice: null, gameAudioApps: [] }} />)
    expect(screen.queryByText('Saved device (unavailable)')).toBeNull()
    resolveDevices([{ id: 'hdmi', name: 'HDMI' }])
    await waitFor(() => expect(screen.getByRole('option', { name: 'HDMI' })).toBeInTheDocument())
    expect(screen.queryByText('Saved device (unavailable)')).toBeNull()
  })
})
