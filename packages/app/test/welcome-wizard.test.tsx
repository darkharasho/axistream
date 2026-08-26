import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WelcomeWizard } from '../src/renderer/components/WelcomeWizard.js'
import { INITIAL_STATE, type AppState } from '../src/shared/state.js'

const axi = {
  provision: vi.fn(async () => {}),
  connectYouTube: vi.fn(async () => {}),
  getAudioDevices: vi.fn(async () => [{ id: 'mic1', name: 'Blue Yeti' }]),
  setMicEnabled: vi.fn(async () => {}),
  setMicDevice: vi.fn(async () => {}),
  recordAudioTest: vi.fn(async () => ({ ok: true, clip: new Uint8Array([1]), mime: 'audio/mp4' })),
}

const cap = { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, outputWidth: 1920, outputHeight: 1080, fps: 60 }
const mk = (over: Partial<AppState> = {}): AppState => ({ ...INITIAL_STATE, phase: 'READY', capture: cap, ...over })

const open = (over: Partial<AppState> = {}, onClose = vi.fn()) => {
  render(<WelcomeWizard state={mk(over)} axi={axi as never} onClose={onClose} />)
  return onClose
}

describe('WelcomeWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    URL.createObjectURL = URL.createObjectURL ?? (() => 'blob:mock')
    URL.revokeObjectURL = URL.revokeObjectURL ?? (() => {})
  })

  it('confirms an already-configured capture instead of re-asking', () => {
    open()

    expect(screen.getByText(/Guild Wars 2/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled()
  })

  it('cannot advance past capture until something is captured', () => {
    open({ capture: null })

    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /choose what to capture/i })).toBeInTheDocument()
  })

  it('runs the existing provisioning flow rather than its own picker', async () => {
    open({ capture: null })

    await userEvent.click(screen.getByRole('button', { name: /choose what to capture/i }))

    expect(axi.provision).toHaveBeenCalledOnce()
  })

  it('connects YouTube on the second step', async () => {
    open()

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /connect youtube/i }))

    expect(axi.connectYouTube).toHaveBeenCalledOnce()
  })

  it('shows the connected channel instead of the connect button', async () => {
    open({ youtube: { connected: true, channel: 'Axi' } })

    await userEvent.click(screen.getByRole('button', { name: /next/i }))

    expect(screen.getByText(/Connected as Axi/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /connect youtube/i })).toBeNull()
  })

  it('records a mic test on the third step', async () => {
    open()

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /test my mic/i }))

    expect(axi.recordAudioTest).toHaveBeenCalledOnce()
  })

  it('goes back a step', async () => {
    open()

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /back/i }))

    expect(screen.getByText(/Guild Wars 2/)).toBeInTheDocument()
  })

  // Every exit route dismisses — otherwise the banner outlives the wizard and
  // the user is nagged by something they already finished.
  it('dismisses when skipped', async () => {
    const onClose = open()

    await userEvent.click(screen.getByRole('button', { name: /skip setup/i }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('dismisses when closed with the X', async () => {
    const onClose = open()

    await userEvent.click(screen.getByRole('button', { name: /close/i }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('dismisses when finished', async () => {
    const onClose = open()

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /go live/i }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
