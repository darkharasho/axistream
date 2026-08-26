// packages/app/test/rebuild-hotkeys.test.ts
import { describe, it, expect, vi } from 'vitest'
import { rebuildHotkeys, pttStateFields } from '../src/main/rebuild-hotkeys.js'

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

describe('pttStateFields', () => {
  it('a failed rebuild with PTT enabled surfaces a non-null error (this is the renderer\'s ONLY ptt error surface)', () => {
    // Regression guard: gating error on the post-rebuild ARMED state instead
    // of the user's INTENT makes this permanently unreachable, because
    // rebuildHotkeys always disarms on failure — the one case that needs to
    // report the error is exactly the case that just got disarmed.
    const fields = pttStateFields({ ok: false, error: 'portal denied' }, { armed: false, wantsPtt: true, mode: null })
    expect(fields.error).toBe('portal denied')
    expect(fields.enabled).toBe(false)
  })

  it('falls back to a generic message when the rebuild result carries no error string', () => {
    const fields = pttStateFields({ ok: false }, { armed: false, wantsPtt: true, mode: null })
    expect(fields.error).toBe('failed')
  })

  it('reports no ptt error when the user does not want PTT, even if the rebuild failed', () => {
    // The rebuild failure may be entirely about an unrelated action hotkey —
    // attributing it to push-to-talk when the user never asked for PTT would
    // mislead them.
    const fields = pttStateFields({ ok: false, error: 'x' }, { armed: false, wantsPtt: false, mode: null })
    expect(fields.error).toBeNull()
  })

  it('reports no error on a successful rebuild regardless of intent', () => {
    expect(pttStateFields({ ok: true }, { armed: true, wantsPtt: true, mode: 'passthrough' }).error).toBeNull()
    expect(pttStateFields({ ok: true }, { armed: false, wantsPtt: false, mode: null }).error).toBeNull()
  })

  it('mode is null unless PTT is actually armed', () => {
    expect(pttStateFields({ ok: true }, { armed: true, wantsPtt: true, mode: 'exclusive' }).mode).toBe('exclusive')
    expect(pttStateFields({ ok: true }, { armed: false, wantsPtt: true, mode: 'exclusive' }).mode).toBeNull()
  })
})
