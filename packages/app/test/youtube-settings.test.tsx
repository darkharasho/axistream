import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { YouTubeSettings } from '../src/renderer/components/YouTubeSettings.js'

const axi = {
  connectYouTube: vi.fn(async () => {}),
  disconnectYouTube: vi.fn(async () => {}),
  getSettings: vi.fn(async () => ({ titleTemplate: 'EWW - {{date}}', dateFormat: 'YYYY-MM-DD', privacy: 'public' as const, discordWebhookUrl: '', discordMessage: '' })),
  saveSettings: vi.fn(async (p: any) => ({ titleTemplate: 'EWW - {{date}}', dateFormat: 'YYYY-MM-DD', privacy: 'public' as const, discordWebhookUrl: '', discordMessage: '', ...p })),
  previewTitle: vi.fn(async () => 'EWW - 2026-06-24'),
  testDiscordWebhook: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
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

  it('saves the discord webhook url on edit', async () => {
    render(<YouTubeSettings youtube={{ connected: true, channel: 'My Channel' }} />)
    const input = await screen.findByLabelText(/discord webhook/i)
    fireEvent.change(input, { target: { value: 'https://discord.com/api/webhooks/1/tok' } })
    expect(axi.saveSettings).toHaveBeenCalledWith({ discordWebhookUrl: 'https://discord.com/api/webhooks/1/tok' })
  })

  it('Send test is disabled until a webhook is present, then calls testDiscordWebhook and shows success', async () => {
    render(<YouTubeSettings youtube={{ connected: true, channel: 'My Channel' }} />)
    const btn = await screen.findByRole('button', { name: /send test/i })
    expect(btn).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/discord webhook/i), { target: { value: 'https://discord.com/api/webhooks/1/tok' } })
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    await waitFor(() => expect(axi.testDiscordWebhook).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText(/sent/i)).toBeInTheDocument())
  })

  it('shows the error text when the test fails', async () => {
    axi.testDiscordWebhook.mockResolvedValueOnce({ ok: false, error: 'discord returned 404' })
    render(<YouTubeSettings youtube={{ connected: true, channel: 'My Channel' }} />)
    fireEvent.change(await screen.findByLabelText(/discord webhook/i), { target: { value: 'https://x' } })
    fireEvent.click(screen.getByRole('button', { name: /send test/i }))
    await waitFor(() => expect(screen.getByText(/discord returned 404/i)).toBeInTheDocument())
  })
})
