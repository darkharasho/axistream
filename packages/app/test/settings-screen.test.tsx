import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsScreen } from '../src/renderer/components/SettingsScreen.js'
import type { AppState } from '../src/shared/state.js'

const axi = {
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
  appVersion: vi.fn(async () => '0.1.4'),
  checkForUpdates: vi.fn(async () => {}),
  installUpdate: vi.fn(async () => {}),
  getWhatsNew: vi.fn(async () => ({ version: '0.1.4', notes: null as string | null })),
  setLastSeenVersion: vi.fn(async () => {}),
  onUpdateStatus: vi.fn(() => () => {}),
}
beforeEach(() => { (globalThis as any).axi = axi; vi.clearAllMocks() })

const base: AppState = {
  phase: 'READY',
  capture: null,
  captureTargets: [],
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
  ptt: { available: false, enabled: false, active: false, error: null, mode: null, keyName: 'F18', keyCode: 188, modifier: null }, windowFitted: false, masksVisible: true, liveUnconfirmed: false, watchUrl: null,
}

describe('SettingsScreen', () => {
  it('shows the auto-chosen quality line', () => {
    render(<SettingsScreen state={{ ...base, encoder: 'NVENC', videoBitrateKbps: 24000, capture: { sourceLabel: 'GW2', width: 3440, height: 1440, outputWidth: 3440, outputHeight: 1440, fps: 60 } }} axi={axi as any} />)
    expect(screen.getByText('Quality')).toBeInTheDocument()
    expect(screen.getByText(/NVENC · 24 Mbps — chosen automatically for 1440p60/)).toBeInTheDocument()
  })

  it('offers Re-set up capture', async () => {
    render(<SettingsScreen state={base} axi={axi as any} />)
    fireEvent.click(screen.getByRole('button', { name: /re-set up capture/i }))
    expect(axi.repairCapture).toHaveBeenCalledOnce()
    await waitFor(() => expect(axi.getSettings).toHaveBeenCalled())
  })
})
