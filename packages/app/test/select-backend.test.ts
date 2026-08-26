// packages/app/test/select-backend.test.ts
// The win32 leg is a mic-hot guard, not a nicety: returning an unavailable
// Windows backend hands HotkeyService a poller whose keyDown is permanently
// false, which reports ok, which arms push-to-talk, which baseline-mutes a mic
// nothing can ever unmute.
import { describe, it, expect, vi } from 'vitest'
import { selectHotkeyBackend } from '../src/main/select-backend.js'
import type { HotkeyBackend } from '../src/shared/hotkeys.js'

const backend = (available: boolean, tag: string): HotkeyBackend & { tag: string } => ({
  tag,
  available: async () => available,
  bindAll: vi.fn(async () => ({ onActivated() {}, onDeactivated() {}, close: async () => {} })),
})

const deps = (platform: string, win: boolean, evdev: boolean) => ({
  platform,
  windows: backend(win, 'windows'),
  evdev: backend(evdev, 'evdev'),
  portal: backend(true, 'portal'),
})

describe('selectHotkeyBackend', () => {
  it('picks the Windows backend in passthrough mode when it is available', async () => {
    const d = deps('win32', true, false)
    const r = await selectHotkeyBackend(d)
    expect(r.backend).toBe(d.windows)
    expect(r.mode).toBe('passthrough')
  })

  it('REFUSES on win32 when the Windows backend is unavailable — never returns it anyway', async () => {
    const d = deps('win32', false, false)
    await expect(selectHotkeyBackend(d)).rejects.toThrow(/unavailable/i)
  })

  it('never falls back to a Linux backend on win32', async () => {
    const d = deps('win32', false, true)
    await expect(selectHotkeyBackend(d)).rejects.toThrow()
    expect(d.evdev.bindAll).not.toHaveBeenCalled()
    expect(d.portal.bindAll).not.toHaveBeenCalled()
  })

  it('prefers evdev passthrough on Linux when input access is unlocked', async () => {
    const d = deps('linux', false, true)
    const r = await selectHotkeyBackend(d)
    expect(r.backend).toBe(d.evdev)
    expect(r.mode).toBe('passthrough')
  })

  it('falls back to the portal in exclusive mode when evdev is unavailable', async () => {
    const d = deps('linux', false, false)
    const r = await selectHotkeyBackend(d)
    expect(r.backend).toBe(d.portal)
    expect(r.mode).toBe('exclusive')
  })

  it('re-probes availability on every call so a pkexec unlock upgrades a running app', async () => {
    let unlocked = false
    const evdev: HotkeyBackend = { available: async () => unlocked, bindAll: vi.fn() as never }
    const d = { platform: 'linux', windows: backend(false, 'windows'), evdev, portal: backend(true, 'portal') }
    expect((await selectHotkeyBackend(d)).mode).toBe('exclusive')
    unlocked = true
    expect((await selectHotkeyBackend(d)).mode).toBe('passthrough')
  })
})
