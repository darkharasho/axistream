import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AudioSettings } from '../src/renderer/components/AudioSettings.js'

const axi = {
  getAudioDevices: vi.fn(async () => [{ id: 'default', name: 'Default' }, { id: 'yeti', name: 'Yeti' }]),
  setDesktopEnabled: vi.fn(async () => {}),
  setMicEnabled: vi.fn(async () => {}),
  setMicDevice: vi.fn(async () => {}),
}
beforeEach(() => { (globalThis as any).axi = axi; vi.clearAllMocks() })

describe('AudioSettings', () => {
  it('toggles desktop audio', () => {
    render(<AudioSettings audio={{ desktopEnabled: true, micEnabled: false, micDevice: null }} />)
    fireEvent.click(screen.getByLabelText(/desktop audio/i))
    expect(axi.setDesktopEnabled).toHaveBeenCalledWith(false)
  })

  it('toggles mic and shows a populated device picker', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, micEnabled: true, micDevice: null }} />)
    expect(axi.getAudioDevices).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('option', { name: 'Yeti' })).toBeInTheDocument())
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'yeti' } })
    expect(axi.setMicDevice).toHaveBeenCalledWith('yeti')
  })

  it('does not query devices when mic is off', () => {
    render(<AudioSettings audio={{ desktopEnabled: true, micEnabled: false, micDevice: null }} />)
    expect(axi.getAudioDevices).not.toHaveBeenCalled()
  })
})
