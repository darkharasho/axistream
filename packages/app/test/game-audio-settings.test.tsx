import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GameAudioSettings } from '../src/renderer/components/GameAudioSettings.js'

const axi = { installGameAudioPlugin: vi.fn(async () => {}), relaunchApp: vi.fn(async () => {}) }
beforeEach(() => { (globalThis as any).axi = axi; vi.clearAllMocks() })

const p = (status: string, error: string | null = null) => ({ status: status as any, error })

describe('GameAudioSettings', () => {
  it('unsupported: explains the flatpak requirement, no buttons', () => {
    render(<GameAudioSettings plugin={p('unsupported')} phase="READY" />)
    expect(screen.getByText(/requires the OBS flatpak/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('missing: install button triggers the API', () => {
    render(<GameAudioSettings plugin={p('missing')} phase="READY" />)
    fireEvent.click(screen.getByText('Install plugin'))
    expect(axi.installGameAudioPlugin).toHaveBeenCalled()
  })
  it('installing: disabled button', () => {
    render(<GameAudioSettings plugin={p('installing')} phase="READY" />)
    expect(screen.getByText(/installing/i).closest('button')).toBeDisabled()
  })
  it('installed: restart button relaunches', () => {
    render(<GameAudioSettings plugin={p('installed')} phase="READY" />)
    fireEvent.click(screen.getByText('Restart AxiStream'))
    expect(axi.relaunchApp).toHaveBeenCalled()
  })
  it('installed while LIVE: restart button hidden', () => {
    render(<GameAudioSettings plugin={p('installed')} phase="LIVE" />)
    expect(screen.queryByText('Restart AxiStream')).toBeNull()
    expect(screen.getByText(/restart AxiStream to activate/i)).toBeInTheDocument()
  })
  it('ready: shows Ready, no buttons', () => {
    render(<GameAudioSettings plugin={p('ready')} phase="READY" />)
    expect(screen.getByText(/ready/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('error: shows message and Retry install', () => {
    render(<GameAudioSettings plugin={p('error', 'boom from flatpak')} phase="READY" />)
    expect(screen.getByText('boom from flatpak')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Retry install'))
    expect(axi.installGameAudioPlugin).toHaveBeenCalled()
  })
})
