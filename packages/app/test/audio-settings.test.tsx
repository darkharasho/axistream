import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AudioSettings } from '../src/renderer/components/AudioSettings.js'
import type { AudioTestResult } from '../src/shared/state.js'
import type { PttCaptureResult } from '../src/shared/keys.js'

const axi = {
  getAudioDevices: vi.fn(async () => [{ id: 'default', name: 'Default' }, { id: 'yeti', name: 'Yeti' }]),
  getDesktopDevices: vi.fn(async () => [{ id: 'default', name: 'Default' }, { id: 'hdmi', name: 'HDMI' }]),
  setDesktopEnabled: vi.fn(async () => {}),
  setDesktopDevice: vi.fn(async () => {}),
  setMicEnabled: vi.fn(async () => {}),
  setMicDevice: vi.fn(async () => {}),
  setGameAudioApps: vi.fn(async () => {}),
  getGameAudioApps: vi.fn(async () => [{ id: 'gw2-64.exe', name: 'Guild Wars 2' }, { id: 'Discord', name: 'Discord' }]),
  onAudioLevels: vi.fn(() => () => {}),
  recordAudioTest: vi.fn(async (): Promise<AudioTestResult> => ({ ok: true, clip: new Uint8Array([0]), mime: 'video/mp4' })),
  setPttEnabled: vi.fn(async () => {}),
  unlockPassthrough: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  setPttKey: vi.fn(async () => {}),
  capturePttKey: vi.fn(async (): Promise<PttCaptureResult> => ({ key: { code: 185, name: 'F15' } })),
}
beforeEach(() => {
  (globalThis as any).axi = axi
  vi.clearAllMocks()
  URL.createObjectURL = URL.createObjectURL ?? (() => 'blob:mock')
  URL.revokeObjectURL = URL.revokeObjectURL ?? (() => {})
})

const pluginReady = { status: 'ready' as any, error: null }
const pttOff: { available: boolean; enabled: boolean; active: boolean; error: string | null; mode: 'passthrough' | 'exclusive' | null; keyName: string } = { available: true, enabled: false, active: false, error: null, mode: null, keyName: 'F18' }

describe('AudioSettings', () => {
  it('toggles desktop audio', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={pttOff} />)
    fireEvent.click(screen.getByLabelText(/desktop audio/i))
    expect(axi.setDesktopEnabled).toHaveBeenCalledWith(false)
    await screen.findByLabelText('Guild Wars 2')
  })

  it('toggles mic and shows a populated device picker', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={pttOff} />)
    expect(axi.getAudioDevices).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('option', { name: 'Yeti' })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/microphone device/i), { target: { value: 'yeti' } })
    expect(axi.setMicDevice).toHaveBeenCalledWith('yeti')
  })

  it('does not query devices when mic is off', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={pttOff} />)
    expect(axi.getAudioDevices).not.toHaveBeenCalled()
    await screen.findByLabelText('Guild Wars 2')
  })

  it('populates the output dropdown when desktop audio is on and selection calls setDesktopDevice', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={pttOff} />)
    expect(axi.getDesktopDevices).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('option', { name: 'HDMI' })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/output device/i), { target: { value: 'hdmi' } })
    expect(axi.setDesktopDevice).toHaveBeenCalledWith('hdmi')
    await screen.findByLabelText('Guild Wars 2')
  })

  it('does not query output devices when desktop audio is off', async () => {
    render(<AudioSettings audio={{ desktopEnabled: false, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={pttOff} />)
    expect(axi.getDesktopDevices).not.toHaveBeenCalled()
    await screen.findByLabelText('Guild Wars 2')
  })

  it('renders an unavailable placeholder when the saved output device is not enumerated', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: 'unplugged-dac', micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={pttOff} />)
    expect(await screen.findByText('Saved device (unavailable)')).toBeInTheDocument()
    const select = screen.getByLabelText(/output device/i) as HTMLSelectElement
    expect(select.value).toBe('unplugged-dac')
    await screen.findByLabelText('Guild Wars 2')
  })

  it('renders an unavailable placeholder when the saved mic device is not enumerated', async () => {
    render(<AudioSettings audio={{ desktopEnabled: false, desktopDevice: null, micEnabled: true, micDevice: 'unplugged-mic', gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={pttOff} />)
    expect(await screen.findByText('Saved device (unavailable)')).toBeInTheDocument()
    const select = screen.getByLabelText(/microphone device/i) as HTMLSelectElement
    expect(select.value).toBe('unplugged-mic')
    await screen.findByLabelText('Guild Wars 2')
  })

  it('never flashes the unavailable placeholder while devices are still enumerating', async () => {
    // The saved device IS in the list, but the list resolves late — the
    // placeholder must not appear in the pre-resolution render.
    let resolveDevices: (d: { id: string; name: string }[]) => void = () => {}
    axi.getDesktopDevices.mockImplementationOnce(() => new Promise((r) => { resolveDevices = r }))
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: 'hdmi', micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={pttOff} />)
    expect(screen.queryByText('Saved device (unavailable)')).toBeNull()
    resolveDevices([{ id: 'hdmi', name: 'HDMI' }])
    await waitFor(() => expect(screen.getByRole('option', { name: 'HDMI' })).toBeInTheDocument())
    expect(screen.queryByText('Saved device (unavailable)')).toBeNull()
    await screen.findByLabelText('Guild Wars 2')
  })

  it('checking an app calls setGameAudioApps with the union', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" ptt={pttOff} />)
    fireEvent.click(await screen.findByLabelText('Guild Wars 2'))
    expect(axi.setGameAudioApps).toHaveBeenCalledWith(['gw2-64.exe'])
  })

  it('unchecking an app calls setGameAudioApps without it', async () => {
    render(<AudioSettings audio={{ desktopEnabled: false, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: ['gw2-64.exe', 'Discord'] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" ptt={pttOff} />)
    fireEvent.click(await screen.findByLabelText('Guild Wars 2'))
    expect(axi.setGameAudioApps).toHaveBeenCalledWith(['Discord'])
  })

  it('selected apps sort to the top of the list', async () => {
    // Running order from the mock is Guild Wars 2 then Discord; selecting only
    // Discord must float it above the unselected Guild Wars 2.
    render(<AudioSettings audio={{ desktopEnabled: false, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: ['Discord'] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" ptt={pttOff} />)
    const discord = await screen.findByText('Discord')
    const gw2 = screen.getByText('Guild Wars 2')
    expect(discord.compareDocumentPosition(gw2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('checking All desktop audio while apps are selected still just calls setDesktopEnabled(true)', async () => {
    render(<AudioSettings audio={{ desktopEnabled: false, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: ['gw2-64.exe'] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" ptt={pttOff} />)
    await screen.findByLabelText('Guild Wars 2')
    fireEvent.click(screen.getByLabelText('All desktop audio'))
    expect(axi.setDesktopEnabled).toHaveBeenCalledWith(true)
  })

  it('saved app absent from the running list shows the not-running pill', async () => {
    axi.getGameAudioApps.mockResolvedValueOnce([{ id: 'Discord', name: 'Discord' }])
    render(<AudioSettings audio={{ desktopEnabled: false, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: ['closed-game.exe'] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" ptt={pttOff} />)
    expect(await screen.findByText('not running')).toBeInTheDocument()
    expect(screen.getByLabelText('closed-game.exe')).toBeChecked()
  })

  it('two rapid toggles (no await between) send the full combined selection in the second call', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" ptt={pttOff} />)
    await screen.findByLabelText('Guild Wars 2')
    fireEvent.click(screen.getByLabelText('Guild Wars 2'))
    fireEvent.click(screen.getByLabelText('Discord'))
    expect(axi.setGameAudioApps).toHaveBeenCalledTimes(2)
    expect(axi.setGameAudioApps).toHaveBeenLastCalledWith(['gw2-64.exe', 'Discord'])
  })

  it('refresh re-enumerates', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" ptt={pttOff} />)
    await screen.findByLabelText('Guild Wars 2')
    fireEvent.click(screen.getByTitle('Refresh running apps'))
    expect(axi.getGameAudioApps).toHaveBeenCalledTimes(2)
    // Flush the second getGameAudioApps resolution
    await screen.findByLabelText('Guild Wars 2')
  })

  it('renders pulse meters on the desktop and mic rows and the apps divider', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" ptt={pttOff} />)
    await screen.findByLabelText('Guild Wars 2')
    expect(document.querySelectorAll('.audio-pulse')).toHaveLength(3)
  })

  it('plugin not ready: no app rows, install flow renders instead', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={{ status: 'missing', error: null }} phase="READY" ptt={pttOff} />)
    expect(axi.getGameAudioApps).not.toHaveBeenCalled()
    expect(screen.getByText('Install plugin')).toBeInTheDocument()
    await screen.findByRole('option', { name: 'Default' })
  })

  it('Test audio renders and is disabled while live', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="LIVE" ptt={pttOff} />)
    expect(screen.getByRole('button', { name: /test audio/i })).toBeDisabled()
  })

  it('running a test shows the countdown then a player', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={pttOff} />)
    fireEvent.click(screen.getByRole('button', { name: /test audio/i }))
    expect(screen.getByText(/speak now/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('audio-test-player')).toBeInTheDocument())
    expect(axi.recordAudioTest).toHaveBeenCalled()
  })

  it('a failed test shows the error and allows retry', async () => {
    axi.recordAudioTest.mockResolvedValueOnce({ ok: false, error: 'output busy' })
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={pttOff} />)
    fireEvent.click(screen.getByRole('button', { name: /test audio/i }))
    await waitFor(() => expect(screen.getByText(/output busy/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /test audio/i })).not.toBeDisabled()
  })

  it('a player load failure surfaces as an error instead of a dead 0:00 player', async () => {
    // A CSP-rejected or undecodable blob fires the audio element's error
    // event with no other visible symptom — it must not fail silently.
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={pttOff} />)
    fireEvent.click(screen.getByRole('button', { name: /test audio/i }))
    const player = await screen.findByTestId('audio-test-player')
    fireEvent.error(player)
    expect(screen.getByText(/couldn't play the clip/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /test audio/i })).not.toBeDisabled()
  })

  it('PTT row hidden when the mic is off; visible when on', async () => {
    const base = { desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }
    const { rerender } = render(<AudioSettings audio={base} gameAudioPlugin={pluginReady} phase="READY" ptt={pttOff} />)
    expect(screen.queryByLabelText(/push to talk/i)).not.toBeInTheDocument()
    rerender(<AudioSettings audio={{ ...base, micEnabled: true }} gameAudioPlugin={pluginReady} phase="READY" ptt={pttOff} />)
    expect(screen.getByLabelText(/push to talk/i)).toBeInTheDocument()
  })

  it('toggling PTT calls setPttEnabled', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={pttOff} />)
    fireEvent.click(screen.getByLabelText(/push to talk/i))
    expect(axi.setPttEnabled).toHaveBeenCalledWith(true)
  })

  it('shows TRANSMITTING while active and the portal-missing hint when unavailable', async () => {
    const audio = { desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }
    const { rerender } = render(<AudioSettings audio={audio} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: true, enabled: true, active: true, error: null, mode: null, keyName: 'F18' }} />)
    expect(screen.getByText(/transmitting/i)).toBeInTheDocument()
    rerender(<AudioSettings audio={audio} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: false, enabled: false, active: false, error: null, mode: null, keyName: 'F18' }} />)
    expect(screen.getByLabelText(/push to talk/i)).toBeDisabled()
    expect(screen.getByText(/GlobalShortcuts portal/i)).toBeInTheDocument()
  })

  it('surfaces a PTT error', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: true, enabled: false, active: false, error: 'portal request denied (code 1)', mode: null, keyName: 'F18' }} />)
    expect(screen.getByText(/portal request denied/i)).toBeInTheDocument()
  })

  it('shows the pass-through mode line when armed via evdev', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: true, enabled: true, active: false, error: null, mode: 'passthrough', keyName: 'F18' }} />)
    expect(screen.getByText(/Discord's own push-to-talk works alongside/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /enable pass-through/i })).not.toBeInTheDocument()
  })

  it('exclusive mode shows the warning line and the unlock button; clicking unlocks', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: true, enabled: true, active: false, error: null, mode: 'exclusive', keyName: 'F18' }} />)
    expect(screen.getByText(/Discord won't see F18/i)).toBeInTheDocument()
    expect(screen.getByText(/read access to input devices/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /enable pass-through/i }))
    await waitFor(() => expect(axi.unlockPassthrough).toHaveBeenCalled())
  })

  it('surfaces an unlock failure inline', async () => {
    axi.unlockPassthrough.mockResolvedValueOnce({ ok: false, error: 'Authorization was cancelled' })
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: true, enabled: true, active: false, error: null, mode: 'exclusive', keyName: 'F18' }} />)
    fireEvent.click(screen.getByRole('button', { name: /enable pass-through/i }))
    await waitFor(() => expect(screen.getByText(/authorization was cancelled/i)).toBeInTheDocument())
  })

  it('labels follow ptt.keyName', () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: true, enabled: true, active: false, error: null, mode: 'passthrough', keyName: 'F15' }} />)
    expect(screen.getByLabelText('Push to talk (hold F15)')).toBeInTheDocument()
    expect(screen.getByText(/hold F15 to talk/i)).toBeInTheDocument()
  })

  it('pass-through rebind captures a key', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: true, enabled: true, active: false, error: null, mode: 'passthrough', keyName: 'F18' }} />)
    fireEvent.click(screen.getByRole('button', { name: /rebind/i }))
    expect(screen.getByText(/press any key/i)).toBeInTheDocument()
    await waitFor(() => expect(axi.capturePttKey).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/press any key/i)).not.toBeInTheDocument())
  })

  it('pass-through rebind shows timeout message when capture times out', async () => {
    axi.capturePttKey.mockResolvedValueOnce({ reason: 'timeout' })
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: true, enabled: true, active: false, error: null, mode: 'passthrough', keyName: 'F18' }} />)
    fireEvent.click(screen.getByRole('button', { name: /rebind/i }))
    await waitFor(() => expect(screen.getByText('No key seen — timed out')).toBeInTheDocument())
  })

  it('exclusive rebind is a dropdown calling setPttKey', async () => {
    render(<AudioSettings audio={{ desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }} gameAudioPlugin={pluginReady} phase="READY" ptt={{ available: true, enabled: true, active: false, error: null, mode: 'exclusive', keyName: 'F18' }} />)
    fireEvent.change(screen.getByLabelText(/push-to-talk key/i), { target: { value: 'F13' } })
    expect(axi.setPttKey).toHaveBeenCalledWith({ code: 183, name: 'F13' })
  })
})

describe('AudioSettings app search', () => {
  const ready = { status: 'ready' as const, error: null }
  const base = { desktopEnabled: false, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] }

  it('filters app rows by substring, case-insensitive', async () => {
    axi.getGameAudioApps.mockResolvedValueOnce([
      { id: 'gw2-64.exe', name: 'Guild Wars 2' },
      { id: 'Discord', name: 'Discord' },
    ])
    render(<AudioSettings audio={base} gameAudioPlugin={ready} phase="READY" ptt={pttOff} />)
    await screen.findByLabelText('Guild Wars 2')
    fireEvent.change(screen.getByLabelText('Search apps'), { target: { value: 'guild' } })
    expect(screen.getByLabelText('Guild Wars 2')).toBeInTheDocument()
    expect(screen.queryByLabelText('Discord')).toBeNull()
    fireEvent.change(screen.getByLabelText('Search apps'), { target: { value: '' } })
    expect(await screen.findByLabelText('Discord')).toBeInTheDocument()
  })
})

describe('AudioSettings PTT failed-enable resync', () => {
  it('a failed enable (prop already false) still unchecks the optimistic toggle', async () => {
    const audio = { desktopEnabled: true, desktopDevice: null, micEnabled: true, micDevice: null, gameAudioApps: [] }
    const off: { available: boolean; enabled: boolean; active: boolean; error: string | null; mode: 'passthrough' | 'exclusive' | null; keyName: string } = { available: true, enabled: false, active: false, error: null, mode: null, keyName: 'F18' }
    const { rerender } = render(<AudioSettings audio={audio} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" ptt={off} />)
    fireEvent.click(screen.getByLabelText(/push to talk/i))
    expect(screen.getByLabelText(/push to talk/i)).toBeChecked()
    // Main pushes a FRESH ptt object with enabled still false + an error —
    // the optimistic checkbox must resync even though the VALUE didn't change.
    rerender(<AudioSettings audio={audio} gameAudioPlugin={{ status: 'ready', error: null }} phase="READY" ptt={{ available: true, enabled: false, active: false, error: 'portal request denied (code 1)', mode: null, keyName: 'F18' }} />)
    expect(screen.getByLabelText(/push to talk/i)).not.toBeChecked()
    expect(screen.getByText(/portal request denied/i)).toBeInTheDocument()
  })
})
