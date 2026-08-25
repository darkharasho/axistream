import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DiagnosticsSettings } from '../src/renderer/components/DiagnosticsSettings.js'
import type { AxiApi } from '../src/shared/state.js'

const api = (exportDiagnostics: () => Promise<unknown>) =>
  ({ exportDiagnostics } as unknown as AxiApi)

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
})
