import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsScreen } from '../src/renderer/components/SettingsScreen.js'
import type { AppState } from '../src/shared/state.js'

const axi = { forgetKey: vi.fn(), saveKey: vi.fn(), repairCapture: vi.fn() }
const base: AppState = { phase: 'READY', capture: null, keyMasked: '····7f3a', stats: null, error: null }

describe('SettingsScreen', () => {
  it('shows the saved key with a Forget action', () => {
    render(<SettingsScreen state={base} axi={axi as any} />)
    expect(screen.getByText(/····7f3a/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /forget/i }))
    expect(axi.forgetKey).toHaveBeenCalledOnce()
  })
  it('shows a key input when no key is saved', () => {
    render(<SettingsScreen state={{ ...base, keyMasked: null }} axi={axi as any} />)
    expect(screen.getByPlaceholderText(/stream key/i)).toBeInTheDocument()
  })
  it('offers Re-set up capture', () => {
    render(<SettingsScreen state={base} axi={axi as any} />)
    fireEvent.click(screen.getByRole('button', { name: /re-set up capture/i }))
    expect(axi.repairCapture).toHaveBeenCalledOnce()
  })
})
