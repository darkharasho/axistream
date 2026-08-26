import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

const open = async (over: Partial<AppState> = {}, onClose = vi.fn(), onGoLive = vi.fn()) => {
  render(<WelcomeWizard state={mk(over)} axi={axi as never} onClose={onClose} onGoLive={onGoLive} />)
  // Flush the mounting getAudioDevices() fetch before handing control back —
  // otherwise its state update can land after a test's assertions already
  // ran, tripping React's act() warning on stderr.
  await waitFor(() => expect(axi.getAudioDevices).toHaveBeenCalled())
  return onClose
}

describe('WelcomeWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    URL.createObjectURL = URL.createObjectURL ?? (() => 'blob:mock')
    URL.revokeObjectURL = URL.revokeObjectURL ?? (() => {})
  })

  it('confirms an already-configured capture instead of re-asking', async () => {
    await open()

    expect(screen.getByText(/Guild Wars 2/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled()
  })

  it('cannot advance past capture until something is captured', async () => {
    await open({ capture: null })

    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /choose what to capture/i })).toBeInTheDocument()
  })

  it('runs the existing provisioning flow rather than its own picker', async () => {
    await open({ capture: null })

    await userEvent.click(screen.getByRole('button', { name: /choose what to capture/i }))

    expect(axi.provision).toHaveBeenCalledOnce()
  })

  // On Windows with more than one display, provision() answers
  // CHOOSING_TARGET and StreamScreen's picker renders underneath this modal's
  // backdrop, out of reach. The wizard has to offer the list itself.
  it('offers the display list itself when provisioning asks which one', async () => {
    await open({
      capture: null,
      phase: 'CHOOSING_CAPTURE',
      captureTargets: [
        { label: 'Display 1', property: 'monitor_id', value: 'a' },
        { label: 'Display 2', property: 'monitor_id', value: 'b' },
      ],
    })

    await userEvent.click(screen.getByRole('button', { name: 'Display 2' }))

    expect(axi.provision).toHaveBeenCalledWith({ label: 'Display 2', property: 'monitor_id', value: 'b' })
  })

  it('shows a pending state while capture is being prepared', async () => {
    await open({ capture: null, phase: 'PREPARING_CAPTURE' })

    expect(screen.getByRole('button', { name: /preparing capture/i })).toBeDisabled()
  })

  // provision() restarts the sidecar and polls for a non-black frame: seconds
  // of silence in which an impatient user fires a second concurrent rebuild.
  it('ignores a second click while provisioning is in flight', async () => {
    let release = () => {}
    axi.provision.mockImplementationOnce(() => new Promise<void>((r) => { release = () => r() }))
    await open({ capture: null })

    await userEvent.click(screen.getByRole('button', { name: /choose what to capture/i }))
    await userEvent.click(screen.getByRole('button', { name: /preparing capture/i }))

    expect(axi.provision).toHaveBeenCalledOnce()
    release()
    await waitFor(() => expect(screen.getByRole('button', { name: /choose what to capture/i })).toBeEnabled())
  })

  // An IPC rejection must not surface as an unhandled renderer promise, and it
  // must clear the in-flight guard so a retry is possible.
  it('survives a rejected provision and re-arms the button', async () => {
    axi.provision.mockRejectedValueOnce(new Error('sidecar died'))
    await open({ capture: null })

    await userEvent.click(screen.getByRole('button', { name: /choose what to capture/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /choose what to capture/i })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: /choose what to capture/i }))
    expect(axi.provision).toHaveBeenCalledTimes(2)
  })

  it('connects YouTube on the second step', async () => {
    await open()

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /connect youtube/i }))

    expect(axi.connectYouTube).toHaveBeenCalledOnce()
  })

  it('shows the connected channel instead of the connect button', async () => {
    await open({ youtube: { connected: true, channel: 'Axi' } })

    await userEvent.click(screen.getByRole('button', { name: /next/i }))

    expect(screen.getByText(/Connected as Axi/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /connect youtube/i })).toBeNull()
  })

  it('records a mic test on the third step', async () => {
    await open()

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /test my mic/i }))

    expect(axi.recordAudioTest).toHaveBeenCalledOnce()
  })

  // A rejected recordAudioTest() (as opposed to a resolved { ok: false })
  // must not strand the UI on "Recording — speak now…" forever.
  it('surfaces an error instead of hanging when the mic test call rejects', async () => {
    axi.recordAudioTest.mockRejectedValueOnce(new Error('device busy'))
    await open()

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /test my mic/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('device busy')
    expect(screen.getByRole('button', { name: /test my mic/i })).toBeEnabled()
  })

  it('goes back a step', async () => {
    await open()

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /back/i }))

    expect(screen.getByText(/Guild Wars 2/)).toBeInTheDocument()
  })

  // Every exit route dismisses — otherwise the banner outlives the wizard and
  // the user is nagged by something they already finished.
  it('dismisses when skipped', async () => {
    const onClose = await open()

    await userEvent.click(screen.getByRole('button', { name: /skip setup/i }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('dismisses when closed with the X', async () => {
    const onClose = await open()

    await userEvent.click(screen.getByRole('button', { name: /close/i }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  // "Go live" takes the navigating exit — the wizard is reachable from
  // Settings ▸ About, where merely closing it strands the user on the
  // Settings grid with no Go Live control.
  it('takes the go-live exit when finished', async () => {
    const onClose = vi.fn()
    const onGoLive = vi.fn()
    await open({}, onClose, onGoLive)

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /go live/i }))

    expect(onGoLive).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
  })
})
