import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createWindowsKeys, type WindowsKeysDeps } from '../src/main/windows-keys.js'
import { evdevToVk } from '../src/shared/keys.js'

// ---------------------------------------------------------------------------
// Test harness — fake keyDown lets us drive the poller without real hardware
// ---------------------------------------------------------------------------

function makeHarness(platform = 'win32') {
  // Track which VKs are "held" in the fake keyboard state
  const held = new Set<number>()
  const deps: WindowsKeysDeps = {
    keyDown: (vk) => held.has(vk),
    platform,
  }
  return { deps, held, backend: createWindowsKeys(deps) }
}

// Convenience: VK codes used in tests
const VK_F18   = 0x81  // evdev 188
const VK_V     = 0x56
const VK_CTRL  = 0x11
const VK_LWIN  = 0x5B
const VK_RWIN  = 0x5C

// evdev codes
const EVDEV_F18 = 188
const EVDEV_V   = 47   // from LETTER_CODES

const BINDING_F18  = { key: { code: EVDEV_F18, name: 'F18' }, modifier: null } as const
const BINDING_CF18 = { key: { code: EVDEV_F18, name: 'F18' }, modifier: 'ctrl' as const }
const BINDING_SF18 = { key: { code: EVDEV_F18, name: 'F18' }, modifier: 'super' as const }

describe('createWindowsKeys — available()', () => {
  it('returns true when platform is win32 (injected deps)', async () => {
    const { backend } = makeHarness('win32')
    expect(await backend.available()).toBe(true)
  })

  it('returns false when platform is not win32', async () => {
    const { backend } = makeHarness('linux')
    expect(await backend.available()).toBe(false)
  })
})

describe('createWindowsKeys — bind() validation', () => {
  it('throws a clear error for an unmappable evdev code', async () => {
    const { backend } = makeHarness()
    const badBinding = { key: { code: 999, name: 'KEY_999' }, modifier: null }
    await expect(backend.bind('ptt', 'Push to talk', badBinding))
      .rejects.toThrow(/key not supported on Windows/i)
  })

  it('accepts a valid evdev code without throwing', async () => {
    const { backend } = makeHarness()
    const sc = await backend.bind('ptt', 'Push to talk', BINDING_F18)
    await sc.close()
  })
})

describe('createWindowsKeys — press/release edges (no modifier)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('fires onActivated on key down-edge and onDeactivated on key up-edge', async () => {
    const { backend, held } = makeHarness()
    const sc = await backend.bind('ptt', 'Push to talk', BINDING_F18)
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    sc.onDeactivated(() => seq.push('up'))

    // Key goes down
    held.add(VK_F18)
    vi.advanceTimersByTime(25)
    expect(seq).toEqual(['down'])

    // Still held — no extra events
    vi.advanceTimersByTime(25)
    expect(seq).toEqual(['down'])

    // Key released
    held.delete(VK_F18)
    vi.advanceTimersByTime(25)
    expect(seq).toEqual(['down', 'up'])

    await sc.close()
  })

  it('repeat polls while held fire nothing extra', async () => {
    const { backend, held } = makeHarness()
    const sc = await backend.bind('ptt', 'Push to talk', BINDING_F18)
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    sc.onDeactivated(() => seq.push('up'))

    held.add(VK_F18)
    vi.advanceTimersByTime(200)  // 8 poll ticks
    expect(seq).toEqual(['down'])

    await sc.close()
  })

  it('a second press after release fires again', async () => {
    const { backend, held } = makeHarness()
    const sc = await backend.bind('ptt', 'Push to talk', BINDING_F18)
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    sc.onDeactivated(() => seq.push('up'))

    held.add(VK_F18); vi.advanceTimersByTime(25)
    held.delete(VK_F18); vi.advanceTimersByTime(25)
    held.add(VK_F18); vi.advanceTimersByTime(25)
    held.delete(VK_F18); vi.advanceTimersByTime(25)
    expect(seq).toEqual(['down', 'up', 'down', 'up'])

    await sc.close()
  })

  it('a key held at arm time produces no activation until it cycles', async () => {
    const { backend, held } = makeHarness()
    // Key is already down BEFORE bind
    held.add(VK_F18)
    const sc = await backend.bind('ptt', 'Push to talk', BINDING_F18)
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))

    // Several polls while key is held — should NOT fire (keyWasDown seeds from
    // the live state, so a held key produces no down-edge until it cycles)
    vi.advanceTimersByTime(100)
    expect(seq).toEqual([])

    // Now release and re-press — should fire
    held.delete(VK_F18); vi.advanceTimersByTime(25)
    held.add(VK_F18); vi.advanceTimersByTime(25)
    expect(seq).toEqual(['down'])

    await sc.close()
  })
})

describe('createWindowsKeys — modifier gating (ctrl)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('does not activate when modifier is not held', async () => {
    const { backend, held } = makeHarness()
    const sc = await backend.bind('ptt', 'Push to talk', BINDING_CF18)
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))

    // Key without modifier
    held.add(VK_F18); vi.advanceTimersByTime(25)
    expect(seq).toEqual([])

    await sc.close()
  })

  it('activates when modifier is already held at key down-edge', async () => {
    const { backend, held } = makeHarness()
    const sc = await backend.bind('ptt', 'Push to talk', BINDING_CF18)
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    sc.onDeactivated(() => seq.push('up'))

    held.add(VK_CTRL)
    vi.advanceTimersByTime(25)  // modifier only — no activation
    held.add(VK_F18)
    vi.advanceTimersByTime(25)  // modifier + key — fires
    expect(seq).toEqual(['down'])

    held.delete(VK_F18)
    vi.advanceTimersByTime(25)
    expect(seq).toEqual(['down', 'up'])

    await sc.close()
  })

  it('late modifier (key already down, then modifier pressed) does NOT activate', async () => {
    const { backend, held } = makeHarness()
    const sc = await backend.bind('ptt', 'Push to talk', BINDING_CF18)
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))

    // Key goes down first (no modifier) — poll state now keyWasDown=true, active=false
    held.add(VK_F18); vi.advanceTimersByTime(25)
    // Modifier added while key is held — not a down-edge, so no activation
    held.add(VK_CTRL); vi.advanceTimersByTime(25)
    expect(seq).toEqual([])

    await sc.close()
  })

  it('modifier release while active deactivates (no sticky transmit)', async () => {
    const { backend, held } = makeHarness()
    const sc = await backend.bind('ptt', 'Push to talk', BINDING_CF18)
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    sc.onDeactivated(() => seq.push('up'))

    // Arm with modifier + key
    held.add(VK_CTRL); vi.advanceTimersByTime(25)
    held.add(VK_F18); vi.advanceTimersByTime(25)
    expect(seq).toEqual(['down'])

    // Release modifier while key is still down — deactivates
    held.delete(VK_CTRL); vi.advanceTimersByTime(25)
    expect(seq).toEqual(['down', 'up'])

    // Key release after — no second 'up'
    held.delete(VK_F18); vi.advanceTimersByTime(25)
    expect(seq).toEqual(['down', 'up'])

    await sc.close()
  })
})

describe('createWindowsKeys — super modifier (two VKs)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('activates with VK_LWIN held', async () => {
    const { backend, held } = makeHarness()
    const sc = await backend.bind('ptt', 'Push to talk', BINDING_SF18)
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))

    held.add(VK_LWIN); vi.advanceTimersByTime(25)
    held.add(VK_F18); vi.advanceTimersByTime(25)
    expect(seq).toEqual(['down'])

    await sc.close()
  })

  it('activates with VK_RWIN held', async () => {
    const { backend, held } = makeHarness()
    const sc = await backend.bind('ptt', 'Push to talk', BINDING_SF18)
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))

    held.add(VK_RWIN); vi.advanceTimersByTime(25)
    held.add(VK_F18); vi.advanceTimersByTime(25)
    expect(seq).toEqual(['down'])

    await sc.close()
  })

  it('modifier release of either super VK deactivates', async () => {
    const { backend, held } = makeHarness()
    const sc = await backend.bind('ptt', 'Push to talk', BINDING_SF18)
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    sc.onDeactivated(() => seq.push('up'))

    held.add(VK_LWIN); vi.advanceTimersByTime(25)
    held.add(VK_F18); vi.advanceTimersByTime(25)
    expect(seq).toEqual(['down'])

    // Release LWIN — no RWIN held either, so modHeld=false → deactivates
    held.delete(VK_LWIN); vi.advanceTimersByTime(25)
    expect(seq).toEqual(['down', 'up'])

    await sc.close()
  })
})

describe('createWindowsKeys — without modifier', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('fires even when stray modifier keys are held', async () => {
    const { backend, held } = makeHarness()
    const sc = await backend.bind('ptt', 'Push to talk', BINDING_F18)
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    sc.onDeactivated(() => seq.push('up'))

    held.add(VK_CTRL); vi.advanceTimersByTime(25)  // stray ctrl — irrelevant
    held.add(VK_F18); vi.advanceTimersByTime(25)
    held.delete(VK_F18); vi.advanceTimersByTime(25)
    expect(seq).toEqual(['down', 'up'])

    await sc.close()
  })
})

describe('createWindowsKeys — close stops polling', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('close clears the interval; no more events after close', async () => {
    const { backend, held } = makeHarness()
    const sc = await backend.bind('ptt', 'Push to talk', BINDING_F18)
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))

    held.add(VK_F18); vi.advanceTimersByTime(25)
    expect(seq).toEqual(['down'])

    await sc.close()

    // Advance timers — interval cleared, no more events
    held.delete(VK_F18); vi.advanceTimersByTime(100)
    held.add(VK_F18); vi.advanceTimersByTime(100)
    expect(seq).toEqual(['down'])
  })
})

describe('createWindowsKeys — letter binding (V)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('binds a letter key and fires edges correctly', async () => {
    const { backend, held } = makeHarness()
    const sc = await backend.bind('ptt', 'Push to talk', { key: { code: EVDEV_V, name: 'V' }, modifier: null })
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    sc.onDeactivated(() => seq.push('up'))

    held.add(VK_V); vi.advanceTimersByTime(25)
    held.delete(VK_V); vi.advanceTimersByTime(25)
    expect(seq).toEqual(['down', 'up'])

    await sc.close()
  })
})

describe('evdevToVk (via windows-keys import)', () => {
  it('maps F18 to 0x81', () => {
    expect(evdevToVk(188)).toBe(0x81)
  })
  it('maps V to 0x56', () => {
    expect(evdevToVk(47)).toBe(0x56)
  })
})

describe('createWindowsKeys — key AND modifier held at arm time', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('key AND modifier both held at arm time produce no activation until key cycles', async () => {
    const { backend, held } = makeHarness()
    // Both key and modifier are already held before bind
    held.add(VK_CTRL)
    held.add(VK_F18)
    const sc = await backend.bind('ptt', 'Push to talk', BINDING_CF18)
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))

    // Several polls — keyWasDown seeds from live state, so no down-edge fires
    vi.advanceTimersByTime(100)
    expect(seq).toEqual([])

    // Release only the key (modifier still held), then re-press — should fire
    held.delete(VK_F18); vi.advanceTimersByTime(25)
    held.add(VK_F18); vi.advanceTimersByTime(25)
    expect(seq).toEqual(['down'])

    await sc.close()
  })
})
