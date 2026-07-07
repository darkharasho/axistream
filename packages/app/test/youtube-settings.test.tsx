import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { YouTubeSettings } from '../src/renderer/components/YouTubeSettings.js'

const axi = {
  connectYouTube: vi.fn(async () => {}),
  disconnectYouTube: vi.fn(async () => {}),
  getSettings: vi.fn(async () => ({ titleTemplate: 'EWW - {{date}}', dateFormat: 'YYYY-MM-DD', privacy: 'public' as const })),
  saveSettings: vi.fn(async (p: any) => ({ titleTemplate: 'EWW - {{date}}', dateFormat: 'YYYY-MM-DD', privacy: 'public' as const, ...p })),
  previewTitle: vi.fn(async () => 'EWW - 2026-06-24'),
}
beforeEach(() => { (globalThis as any).axi = axi; vi.clearAllMocks() })

describe('YouTubeSettings', () => {
  it('shows Connect when disconnected and connects on click', async () => {
    render(<YouTubeSettings youtube={{ connected: false, channel: null }} />)
    fireEvent.click(screen.getByRole('button', { name: /connect youtube/i }))
    await waitFor(() => expect(axi.connectYouTube).toHaveBeenCalled())
  })

  it('shows channel + live title preview when connected', async () => {
    render(<YouTubeSettings youtube={{ connected: true, channel: 'My Channel' }} />)
    expect(screen.getByText(/my channel/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('EWW - 2026-06-24')).toBeInTheDocument())
  })

  it('lists GW2 template variables in the cheat-sheet', async () => {
    render(<YouTubeSettings youtube={{ connected: true, channel: 'My Channel' }} />)
    await waitFor(() => expect(screen.getByText(/\{\{character\}\}/)).toBeInTheDocument())
    expect(screen.getByText(/\{\{class\}\}/)).toBeInTheDocument()
    expect(screen.getByText(/\{\{map\}\}/)).toBeInTheDocument()
    expect(screen.getByText(/\{\{race\}\}/)).toBeInTheDocument()
    expect(screen.getByText(/GW2, while in a map/)).toBeInTheDocument()
  })
})
