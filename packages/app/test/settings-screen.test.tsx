import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsScreen } from '../src/renderer/components/SettingsScreen.js'
import type { AppState } from '../src/shared/state.js'

const axi = {
  forgetKey: vi.fn(),
  saveKey: vi.fn(),
  repairCapture: vi.fn(),
  connectYouTube: vi.fn(async () => {}),
  disconnectYouTube: vi.fn(async () => {}),
  getSettings: vi.fn(async () => ({ titleTemplate: '', dateFormat: 'YYYY-MM-DD', privacy: 'public' as const, discordWebhookUrl: '', discordMessage: '' })),
  saveSettings: vi.fn(async (p: any) => ({ titleTemplate: '', dateFormat: 'YYYY-MM-DD', privacy: 'public' as const, discordWebhookUrl: '', discordMessage: '', ...p })),
  previewTitle: vi.fn(async () => ''),
  getAudioDevices: vi.fn(async () => []),
  getDesktopDevices: vi.fn(async () => []),
  setDesktopEnabled: vi.fn(async () => {}),
  setDesktopDevice: vi.fn(async () => {}),
  setMicEnabled: vi.fn(async () => {}),
  setMicDevice: vi.fn(async () => {}),
  setGameAudioApps: vi.fn(async () => {}),
  getGameAudioApps: vi.fn(async () => []),
  onAudioLevels: vi.fn(() => () => {}),
}
beforeEach(() => { (globalThis as any).axi = axi; vi.clearAllMocks() })

const base: AppState = {
  phase: 'READY',
  capture: null,
  keyMasked: '····7f3a',
  stats: null,
  error: null,
  encoder: 'x264',
  videoBitrateKbps: null,
  youtube: { connected: false, channel: null },
  settings: { titleTemplate: '', dateFormat: 'YYYY-MM-DD', privacy: 'public', discordWebhookUrl: '', discordMessage: '' },
  audio: { desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] },
  masks: [],
  gameAudioPlugin: { status: 'missing', error: null },
  blurPlugin: { status: 'missing', error: null },
  maskStyle: 'box',
  ptt: { available: false, enabled: false, active: false, error: null },
}

describe('SettingsScreen', () => {
  it('shows the auto-chosen quality line', () => {
    render(<SettingsScreen state={{ ...base, encoder: 'NVENC', videoBitrateKbps: 24000, capture: { sourceLabel: 'GW2', width: 3440, height: 1440, outputWidth: 3440, outputHeight: 1440, fps: 60 } }} axi={axi as any} />)
    expect(screen.getByText('Quality')).toBeInTheDocument()
    expect(screen.getByText(/NVENC · 24 Mbps — chosen automatically for 1440p60/)).toBeInTheDocument()
  })

  it('shows the saved key with a Forget action', async () => {
    render(<SettingsScreen state={base} axi={axi as any} />)
    expect(screen.getByText(/····7f3a/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /forget/i }))
    expect(axi.forgetKey).toHaveBeenCalledOnce()
    await waitFor(() => expect(axi.getSettings).toHaveBeenCalled())
  })
  it('shows a key input when no key is saved', async () => {
    render(<SettingsScreen state={{ ...base, keyMasked: null }} axi={axi as any} />)
    expect(screen.getByPlaceholderText(/stream key/i)).toBeInTheDocument()
    await waitFor(() => expect(axi.getSettings).toHaveBeenCalled())
  })
  it('offers Re-set up capture', async () => {
    render(<SettingsScreen state={base} axi={axi as any} />)
    fireEvent.click(screen.getByRole('button', { name: /re-set up capture/i }))
    expect(axi.repairCapture).toHaveBeenCalledOnce()
    await waitFor(() => expect(axi.getSettings).toHaveBeenCalled())
  })
})
