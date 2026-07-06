import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GameAudioSettings } from '../src/renderer/components/GameAudioSettings.js'

const axi = {
  installGameAudioPlugin: vi.fn(async () => {}),
  relaunchApp: vi.fn(async () => {}),
  setGameAudioApps: vi.fn(async () => {}),
  getGameAudioApps: vi.fn(async () => [{ id: 'gw2-64.exe', name: 'Guild Wars 2' }]),
}
beforeEach(() => { (globalThis as any).axi = axi; vi.clearAllMocks() })

const p = (status: string, error: string | null = null) => ({ status: status as any, error })
const audio = { desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }

describe('GameAudioSettings', () => {
  it('unsupported: explains the flatpak requirement, no buttons', () => {
    render(<GameAudioSettings plugin={p('unsupported')} phase="READY" audio={audio} />)
    expect(screen.getByText(/requires the OBS flatpak/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('missing: install button triggers the API', () => {
    render(<GameAudioSettings plugin={p('missing')} phase="READY" audio={audio} />)
    fireEvent.click(screen.getByText('Install plugin'))
    expect(axi.installGameAudioPlugin).toHaveBeenCalled()
  })
  it('installing: disabled button', () => {
    render(<GameAudioSettings plugin={p('installing')} phase="READY" audio={audio} />)
    expect(screen.getByText(/installing/i).closest('button')).toBeDisabled()
  })
  it('installed: restart button relaunches', () => {
    render(<GameAudioSettings plugin={p('installed')} phase="READY" audio={audio} />)
    fireEvent.click(screen.getByText('Restart AxiStream'))
    expect(axi.relaunchApp).toHaveBeenCalled()
  })
  it('installed while LIVE: restart button hidden', () => {
    render(<GameAudioSettings plugin={p('installed')} phase="LIVE" audio={audio} />)
    expect(screen.queryByText('Restart AxiStream')).toBeNull()
    expect(screen.getByText(/restart AxiStream to activate/i)).toBeInTheDocument()
  })
  it('error: shows message and Retry install', () => {
    render(<GameAudioSettings plugin={p('error', 'boom from flatpak')} phase="READY" audio={audio} />)
    expect(screen.getByText('boom from flatpak')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Retry install'))
    expect(axi.installGameAudioPlugin).toHaveBeenCalled()
  })

  it('non-ready statuses do not render the toggle (regression)', () => {
    render(<GameAudioSettings plugin={p('missing')} phase="READY" audio={audio} />)
    expect(screen.queryByLabelText(/game audio/i)).toBeNull()
  })
})
