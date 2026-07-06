import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsScreen } from '../src/renderer/components/SettingsScreen.js'
import type { AppState } from '../src/shared/state.js'

const axi = {
  forgetKey: vi.fn(),
  saveKey: vi.fn(),
  repairCapture: vi.fn(),
  connectYouTube: vi.fn(async () => {}),
  disconnectYouTube: vi.fn(async () => {}),
  getSettings: vi.fn(async () => ({ titleTemplate: '', dateFormat: 'YYYY-MM-DD', privacy: 'public' as const })),
  saveSettings: vi.fn(async (p: any) => ({ titleTemplate: '', dateFormat: 'YYYY-MM-DD', privacy: 'public' as const, ...p })),
  previewTitle: vi.fn(async () => ''),
  getAudioDevices: vi.fn(async () => []),
  getDesktopDevices: vi.fn(async () => []),
  setDesktopEnabled: vi.fn(async () => {}),
  setDesktopDevice: vi.fn(async () => {}),
  setMicEnabled: vi.fn(async () => {}),
  setMicDevice: vi.fn(async () => {}),
}
beforeEach(() => { (globalThis as any).axi = axi; vi.clearAllMocks() })

const base: AppState = {
  phase: 'READY',
  capture: null,
  keyMasked: '····7f3a',
  stats: null,
  error: null,
  encoder: 'x264',
  youtube: { connected: false, channel: null },
  settings: { titleTemplate: '', dateFormat: 'YYYY-MM-DD', privacy: 'public' },
  audio: { desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] },
  masks: [],
  gameAudioPlugin: { status: 'missing', error: null },
}

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
