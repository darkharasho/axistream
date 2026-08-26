// packages/app/test/rebuild-hotkeys.test.ts
import { describe, it, expect, vi } from 'vitest'
import { rebuildHotkeys } from '../src/main/rebuild-hotkeys.js'

describe('rebuildHotkeys', () => {
  it('arms PTT after a successful rebuild when the user has PTT enabled', async () => {
    const armPtt = vi.fn(async () => {})
    const disarmPtt = vi.fn(async () => {})
    const r = await rebuildHotkeys({ rebuild: async () => ({ ok: true }), pttEnabled: () => true, armPtt, disarmPtt })
    expect(r).toEqual({ ok: true })
    expect(armPtt).toHaveBeenCalledTimes(1)
    expect(disarmPtt).not.toHaveBeenCalled()
  })

  it('does not arm when the rebuild succeeds but PTT is disabled, and does not touch the source', async () => {
    const armPtt = vi.fn(async () => {})
    const disarmPtt = vi.fn(async () => {})
    await rebuildHotkeys({ rebuild: async () => ({ ok: true }), pttEnabled: () => false, armPtt, disarmPtt })
    expect(armPtt).not.toHaveBeenCalled()
    expect(disarmPtt).not.toHaveBeenCalled()
  })

  it('mic-hot invariant: a FAILED rebuild never arms PTT and disarms any stale mute — the source is left unmuted', async () => {
    const armPtt = vi.fn(async () => {})
    const disarmPtt = vi.fn(async () => {})
    const r = await rebuildHotkeys({
      rebuild: async () => ({ ok: false, error: 'portal denied' }),
      pttEnabled: () => true,
      armPtt,
      disarmPtt,
    })
    expect(r).toEqual({ ok: false, error: 'portal denied' })
    expect(armPtt).not.toHaveBeenCalled()
    expect(disarmPtt).toHaveBeenCalledTimes(1)
  })

  it('a failed rebuild disarms even when PTT was never enabled (harmless no-op downstream, but never skipped here)', async () => {
    const armPtt = vi.fn(async () => {})
    const disarmPtt = vi.fn(async () => {})
    await rebuildHotkeys({ rebuild: async () => ({ ok: false, error: 'x' }), pttEnabled: () => false, armPtt, disarmPtt })
    expect(armPtt).not.toHaveBeenCalled()
    expect(disarmPtt).toHaveBeenCalledTimes(1)
  })

  it('propagates the rebuild result unchanged', async () => {
    const armPtt = vi.fn(async () => {})
    const disarmPtt = vi.fn(async () => {})
    const r = await rebuildHotkeys({ rebuild: async () => ({ ok: false, error: 'no readable input devices' }), pttEnabled: () => true, armPtt, disarmPtt })
    expect(r).toEqual({ ok: false, error: 'no readable input devices' })
  })
})
