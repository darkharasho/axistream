import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UpdatesSettings } from '../src/renderer/components/UpdatesSettings.js'

let statusCb: ((s: unknown) => void) | null = null
const axi = {
  appVersion: vi.fn(async () => '0.1.4'),
  checkForUpdates: vi.fn(async () => {}),
  installUpdate: vi.fn(async () => {}),
  getWhatsNew: vi.fn(async () => ({ version: '0.1.4', notes: null as string | null })),
  setLastSeenVersion: vi.fn(async () => {}),
  onUpdateStatus: vi.fn((cb: (s: unknown) => void) => { statusCb = cb; return () => {} }),
}
beforeEach(() => { (globalThis as any).axi = axi; vi.clearAllMocks(); statusCb = null })

describe('UpdatesSettings', () => {
  it('shows the current version and checks on click', async () => {
    render(<UpdatesSettings />)
    await waitFor(() => expect(screen.getByText(/0\.1\.4/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /check for updates/i }))
    expect(axi.checkForUpdates).toHaveBeenCalled()
  })

  it('renders the downloading percent and the Restart control when ready', async () => {
    render(<UpdatesSettings />)
    await waitFor(() => expect(statusCb).not.toBeNull())
    statusCb!({ state: 'downloading', percent: 42 })
    await waitFor(() => expect(screen.getByText(/42%/)).toBeInTheDocument())
    statusCb!({ state: 'ready', version: '0.1.5' })
    const restart = await screen.findByRole('button', { name: /restart/i })
    fireEvent.click(restart)
    expect(axi.installUpdate).toHaveBeenCalled()
  })

  it('surfaces an error status', async () => {
    render(<UpdatesSettings />)
    await waitFor(() => expect(statusCb).not.toBeNull())
    statusCb!({ state: 'error', message: 'A temporary network error interrupted the update check. Please try again.' })
    await waitFor(() => expect(screen.getByText(/temporary network error/i)).toBeInTheDocument())
  })

  it('shows What\'s new notes and dismisses them', async () => {
    axi.getWhatsNew.mockResolvedValueOnce({ version: '0.1.4', notes: '## v0.1.4\n\nSettable PTT hotkey' })
    render(<UpdatesSettings />)
    await waitFor(() => expect(screen.getByText(/settable ptt hotkey/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /got it/i }))
    expect(axi.setLastSeenVersion).toHaveBeenCalledWith('0.1.4')
  })
})
