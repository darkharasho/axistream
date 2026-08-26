import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AboutSettings } from '../src/renderer/components/AboutSettings.js'

const axi = {
  appVersion: vi.fn(async () => '1.0.0'),
  openExternalUrl: vi.fn(async () => true),
}
beforeEach(() => { (globalThis as any).axi = axi; vi.clearAllMocks() })

describe('AboutSettings', () => {
  it('shows the running version', async () => {
    render(<AboutSettings onRunSetup={() => {}} />)

    expect(await screen.findByText(/1\.0\.0/)).toBeInTheDocument()
  })

  // AxiStream redistributes a GPL-2.0-or-later OBS build; the attribution and
  // the route to the corresponding source have to be reachable from the app,
  // not only from the repository.
  it('attributes the bundled OBS with its version and license', async () => {
    render(<AboutSettings onRunSetup={() => {}} />)
    await waitFor(() => expect(axi.appVersion).toHaveBeenCalled())

    expect(screen.getByText(/OBS Studio 32\.1\.2/)).toBeInTheDocument()
    expect(screen.getByText(/GPL-2\.0-or-later/)).toBeInTheDocument()
  })

  it('opens the OBS redistribution notes externally', async () => {
    render(<AboutSettings onRunSetup={() => {}} />)
    await waitFor(() => expect(axi.appVersion).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /how we bundle obs/i }))

    expect(axi.openExternalUrl).toHaveBeenCalledWith('https://github.com/darkharasho/axistream/blob/main/docs/obs-redistribution.md')
  })

  it('links the corresponding source to the latest release', async () => {
    render(<AboutSettings onRunSetup={() => {}} />)
    await waitFor(() => expect(axi.appVersion).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /source for the bundled obs/i }))

    expect(axi.openExternalUrl).toHaveBeenCalledWith('https://github.com/darkharasho/axistream/releases/latest')
  })

  // Spec §5: both the app's own licence and the third-party notices have to
  // be reachable from the About panel, not only from the repository.
  it('links the app licence and the third-party notices', async () => {
    render(<AboutSettings onRunSetup={() => {}} />)
    await waitFor(() => expect(axi.appVersion).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /license \(mit\)/i }))
    expect(axi.openExternalUrl).toHaveBeenCalledWith('https://github.com/darkharasho/axistream/blob/main/LICENSE')

    await userEvent.click(screen.getByRole('button', { name: /third-party licenses/i }))
    expect(axi.openExternalUrl).toHaveBeenCalledWith('https://github.com/darkharasho/axistream/blob/main/THIRD_PARTY_NOTICES.md')
  })

  it('reopens the wizard, so dismissing the banner is never a dead end', async () => {
    const onRunSetup = vi.fn()
    render(<AboutSettings onRunSetup={onRunSetup} />)
    await waitFor(() => expect(axi.appVersion).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /run setup again/i }))

    expect(onRunSetup).toHaveBeenCalledOnce()
  })
})
