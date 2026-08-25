import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DiagnosticsSettings } from '../src/renderer/components/DiagnosticsSettings.js'

const api = (r = { ok: true, path: '/tmp/x.zip' }) =>
  ({ exportDiagnostics: vi.fn().mockResolvedValue(r) }) as never

describe('DiagnosticsSettings', () => {
  it('states what the bundle excludes, so the user can trust it', () => {
    render(<DiagnosticsSettings axi={api()} />)
    expect(screen.getByText(/stream key/i)).toBeInTheDocument()
  })

  it('calls exportDiagnostics on click', async () => {
    const axi = api()
    render(<DiagnosticsSettings axi={axi} />)
    fireEvent.click(screen.getByRole('button', { name: /export diagnostics/i }))
    await waitFor(() => expect(axi.exportDiagnostics).toHaveBeenCalled())
  })

  it('disables the button while collecting', async () => {
    let release: (v: unknown) => void = () => {}
    const axi = { exportDiagnostics: vi.fn(() => new Promise((r) => { release = r })) } as never
    render(<DiagnosticsSettings axi={axi} />)
    const btn = screen.getByRole('button', { name: /export diagnostics/i })
    fireEvent.click(btn)
    await waitFor(() => expect(btn).toBeDisabled())
    release({ ok: true, path: '/tmp/x.zip' })
    await waitFor(() => expect(btn).not.toBeDisabled())
  })
})
