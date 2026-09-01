import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DiagnosticsSettings } from '../src/renderer/components/DiagnosticsSettings.js'
import type { AxiApi } from '../src/shared/state.js'

const api = (exportDiagnostics: () => Promise<unknown>, extra: Partial<AxiApi> = {}) =>
  ({ exportDiagnostics, ...extra } as unknown as AxiApi)

describe('DiagnosticsSettings', () => {
  it('states what the bundle excludes, so the user can trust it', () => {
    render(<DiagnosticsSettings axi={api(vi.fn().mockResolvedValue({ ok: true }))} />)
    expect(screen.getByText(/stream key/i)).toBeInTheDocument()
  })

  it('calls exportDiagnostics on click', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, path: '/tmp/x.zip' })
    render(<DiagnosticsSettings axi={api(spy)} />)
    fireEvent.click(screen.getByRole('button', { name: /export diagnostics/i }))
    await waitFor(() => expect(spy).toHaveBeenCalled())
  })

  it('disables the button while collecting', async () => {
    let release: (v: unknown) => void = () => {}
    const spy = vi.fn(() => new Promise((r) => { release = r }))
    render(<DiagnosticsSettings axi={api(spy)} />)
    const btn = screen.getByRole('button', { name: /export diagnostics/i })
    fireEvent.click(btn)
    await waitFor(() => expect(btn).toBeDisabled())
    release({ ok: true, path: '/tmp/x.zip' })
    await waitFor(() => expect(btn).not.toBeDisabled())
  })

  // A path the user can't find is a bundle they can't send.
  it('shows the bundle and reveals it in the file manager', async () => {
    const revealFile = vi.fn().mockResolvedValue({ ok: true })
    render(<DiagnosticsSettings axi={api(vi.fn().mockResolvedValue({ ok: true, path: '/tmp/axistream-diagnostics-1.zip' }), { revealFile })} />)
    fireEvent.click(screen.getByRole('button', { name: /export diagnostics/i }))
    const reveal = await screen.findByRole('button', { name: /show in folder/i })
    expect(screen.getByText('/tmp/axistream-diagnostics-1.zip')).toBeInTheDocument()
    fireEvent.click(reveal)
    expect(revealFile).toHaveBeenCalledWith('/tmp/axistream-diagnostics-1.zip')
  })

  it('copies the path and confirms it', async () => {
    const copyToClipboard = vi.fn().mockResolvedValue(true)
    render(<DiagnosticsSettings axi={api(vi.fn().mockResolvedValue({ ok: true, path: '/tmp/x.zip' }), { copyToClipboard })} />)
    fireEvent.click(screen.getByRole('button', { name: /export diagnostics/i }))
    fireEvent.click(await screen.findByRole('button', { name: /copy path/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument())
    expect(copyToClipboard).toHaveBeenCalledWith('/tmp/x.zip')
  })

  // A failed export must not leave a stale path pointing at nothing.
  it('offers nothing to share when the export failed', async () => {
    render(<DiagnosticsSettings axi={api(vi.fn().mockResolvedValue({ ok: false, error: 'nope' }))} />)
    fireEvent.click(screen.getByRole('button', { name: /export diagnostics/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /export diagnostics/i })).not.toBeDisabled())
    expect(screen.queryByRole('button', { name: /show in folder/i })).not.toBeInTheDocument()
  })
})
