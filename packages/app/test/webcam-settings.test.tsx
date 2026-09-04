import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WebcamSettings } from '../src/renderer/components/WebcamSettings.js'
import { DEFAULT_WEBCAM, type WebcamView } from '../src/shared/state.js'

const view = (p: Partial<WebcamView> = {}): WebcamView => ({ ...DEFAULT_WEBCAM, available: true, ...p })

const api = (over: Record<string, unknown> = {}) => ({
  setWebcam: vi.fn(async () => {}),
  getWebcamDevices: vi.fn(async () => [{ id: '/dev/video0', name: 'C920' }]),
  getWebcamProps: vi.fn(async () => ({ pixelformats: [], resolutions: [], framerates: [] })),
  ...over,
} as any)

describe('WebcamSettings', () => {
  it('lists cameras from the main process', async () => {
    render(<WebcamSettings webcam={view()} axi={api()} />)
    // Options only exist while the listbox is open (components/Select.tsx).
    await waitFor(() => expect(screen.getByLabelText('Camera')).toBeTruthy())
    await userEvent.click(screen.getByLabelText('Camera'))
    expect(screen.getByRole('option', { name: 'C920' })).toBeTruthy()
  })

  it('enables the camera through setWebcam', async () => {
    const axi = api()
    render(<WebcamSettings webcam={view()} axi={axi} />)
    await userEvent.click(screen.getByLabelText(/show my camera/i))
    expect(axi.setWebcam).toHaveBeenCalledWith({ enabled: true })
  })

  it('sends the chosen corner', async () => {
    const axi = api()
    render(<WebcamSettings webcam={view({ enabled: true, deviceId: '/dev/video0' })} axi={axi} />)
    await userEvent.click(screen.getByRole('button', { name: /top left/i }))
    expect(axi.setWebcam).toHaveBeenCalledWith({ corner: 'tl' })
  })

  it('sends the mirror toggle', async () => {
    const axi = api()
    render(<WebcamSettings webcam={view({ enabled: true, deviceId: '/dev/video0' })} axi={axi} />)
    await userEvent.click(screen.getByLabelText(/mirror/i))
    expect(axi.setWebcam).toHaveBeenCalledWith({ mirrored: true })
  })

  it('shows an unavailable warning when the camera is gone', () => {
    render(<WebcamSettings webcam={view({ enabled: true, deviceId: '/dev/video0', available: false })} axi={api()} />)
    expect(screen.getByText(/unavailable/i)).toBeTruthy()
  })

  it('does not fetch properties until a device is selected', async () => {
    const axi = api()
    render(<WebcamSettings webcam={view({ enabled: true })} axi={axi} />)
    await waitFor(() => expect(axi.getWebcamDevices).toHaveBeenCalled())
    expect(axi.getWebcamProps).not.toHaveBeenCalled()
  })

  it('fetches properties once a device is selected', async () => {
    const axi = api()
    render(<WebcamSettings webcam={view({ enabled: true, deviceId: '/dev/video0' })} axi={axi} />)
    await waitFor(() => expect(axi.getWebcamProps).toHaveBeenCalled())
  })
})
