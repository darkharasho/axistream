import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HotkeySettings } from '../src/renderer/components/HotkeySettings.js'
import { DEFAULT_HOTKEY_STATE } from '../src/shared/state.js'

const api = (over: Record<string, unknown> = {}) => ({
  setHotkey: vi.fn(async () => ({ ok: true })),
  ...over,
})

describe('HotkeySettings', () => {
  it('renders a row per action, all unbound by default', () => {
    render(<HotkeySettings hotkeys={DEFAULT_HOTKEY_STATE} axi={api() as never} />)
    for (const label of ['Go live / End stream', 'Mic mute', 'Masks', 'Record']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getAllByRole('button', { name: /set key/i })).toHaveLength(4)
  })

  it('warns that bound keys are taken from the game on the exclusive backend', () => {
    render(<HotkeySettings hotkeys={{ ...DEFAULT_HOTKEY_STATE, mode: 'exclusive' }} axi={api() as never} />)
    expect(screen.getByText(/won't reach guild wars 2/i)).toBeInTheDocument()
  })

  it('says keys still reach the game on a pass-through backend', () => {
    render(<HotkeySettings hotkeys={{ ...DEFAULT_HOTKEY_STATE, mode: 'passthrough' }} axi={api() as never} />)
    expect(screen.getByText(/still reach guild wars 2/i)).toBeInTheDocument()
  })

  it('shows the refusal, naming the holder, when a key is already bound', async () => {
    const axi = api({ setHotkey: vi.fn(async () => ({ ok: false, conflict: 'Masks' })) })
    render(<HotkeySettings hotkeys={DEFAULT_HOTKEY_STATE} axi={axi as never} />)

    fireEvent.click(screen.getAllByRole('button', { name: /set key/i })[0])
    fireEvent.click(screen.getByRole('button', { name: 'F13' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/already bound to Masks/i))
  })

  it('clears a binding through setHotkey(id, null)', () => {
    const axi = api()
    render(<HotkeySettings axi={axi as never} hotkeys={{
      ...DEFAULT_HOTKEY_STATE,
      bindings: { ...DEFAULT_HOTKEY_STATE.bindings, masks: { key: { code: 183, name: 'F13' }, modifier: null } },
    }} />)

    fireEvent.click(screen.getByRole('button', { name: /clear/i }))

    expect(axi.setHotkey).toHaveBeenCalledWith('masks', null)
  })

  it('surfaces a bind error from the backend', () => {
    render(<HotkeySettings axi={api() as never} hotkeys={{ ...DEFAULT_HOTKEY_STATE, error: 'portal denied' }} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/portal denied/)
  })
})
