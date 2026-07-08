// packages/app/test/ptt-controller.test.ts
import { describe, it, expect, vi } from 'vitest'
import { PttController, type PortalShortcut } from '../src/main/PttController.js'

function harness(opts: { bindError?: string; execError?: boolean; availableResult?: boolean } = {}) {
  let activated: (() => void) | null = null
  let deactivated: (() => void) | null = null
  const shortcut: PortalShortcut = {
    onActivated: (cb) => { activated = cb },
    onDeactivated: (cb) => { deactivated = cb },
    close: vi.fn(async () => {}),
  }
  const mutes: string[] = []
  const actives: boolean[] = []
  const ctl = new PttController({
    portal: {
      available: vi.fn(async () => opts.availableResult ?? true),
      bind: vi.fn(async () => { if (opts.bindError) throw new Error(opts.bindError); return shortcut }),
    },
    exec: vi.fn(async (_cmd, args) => {
      if (opts.execError) throw new Error('pactl failed')
      mutes.push(args.join(' '))
    }),
    sourceId: () => '@DEFAULT_SOURCE@',
    onActive: (a) => actives.push(a),
    binding: () => ({ key: { code: 188, name: 'F18' }, modifier: null }),
  })
  return { ctl, shortcut, mutes, actives, press: () => activated?.(), release: () => deactivated?.() }
}

describe('PttController', () => {
  it('enable binds the shortcut then mutes the source (PTT baseline = muted)', async () => {
    const h = harness()
    const r = await h.ctl.enable()
    expect(r).toEqual({ ok: true })
    expect(h.ctl.isEnabled()).toBe(true)
    expect(h.mutes).toEqual(['set-source-mute @DEFAULT_SOURCE@ 1'])
  })

  it('press unmutes + reports active; release mutes + reports inactive', async () => {
    const h = harness()
    await h.ctl.enable()
    h.press()
    await new Promise((r) => setTimeout(r, 0))
    h.release()
    await new Promise((r) => setTimeout(r, 0))
    expect(h.mutes).toEqual([
      'set-source-mute @DEFAULT_SOURCE@ 1',
      'set-source-mute @DEFAULT_SOURCE@ 0',
      'set-source-mute @DEFAULT_SOURCE@ 1',
    ])
    expect(h.actives).toEqual([true, false])
  })

  it('disable closes the shortcut and UNMUTES (never strand the user muted)', async () => {
    const h = harness()
    await h.ctl.enable()
    await h.ctl.disable()
    expect(h.ctl.isEnabled()).toBe(false)
    expect(h.shortcut.close).toHaveBeenCalled()
    expect(h.mutes[h.mutes.length - 1]).toBe('set-source-mute @DEFAULT_SOURCE@ 0')
    expect(h.actives[h.actives.length - 1]).toBe(false)
  })

  it('restore unconditionally unmutes (crash recovery)', async () => {
    const h = harness()
    await h.ctl.restore()
    expect(h.mutes).toEqual(['set-source-mute @DEFAULT_SOURCE@ 0'])
  })

  it('a bind failure returns the error and never touches the source', async () => {
    const h = harness({ bindError: 'portal said no' })
    const r = await h.ctl.enable()
    expect(r.ok).toBe(false)
    expect(r.error).toContain('portal said no')
    expect(h.ctl.isEnabled()).toBe(false)
    expect(h.mutes).toEqual([])
  })

  it('exec failures are swallowed (never throw out)', async () => {
    const h = harness({ execError: true })
    await expect(h.ctl.enable()).resolves.toEqual({ ok: true })
    await expect(h.ctl.disable()).resolves.toBeUndefined()
    await expect(h.ctl.restore()).resolves.toBeUndefined()
  })

  it('enable is a no-op when already enabled; disable when disabled', async () => {
    const h = harness()
    await h.ctl.enable()
    const again = await h.ctl.enable()
    expect(again).toEqual({ ok: true })
    expect(h.mutes.filter((m) => m.endsWith('1'))).toHaveLength(1)
    const fresh = harness()
    await fresh.ctl.disable()
    expect(fresh.mutes).toEqual([])
  })

  it('enable binds with the binding from the binding() dep', async () => {
    let bound: unknown = null
    const ctl = new PttController({
      portal: { available: async () => true, bind: async (_i, _d, binding) => { bound = binding; return { onActivated: () => {}, onDeactivated: () => {}, close: async () => {} } } },
      exec: async () => {}, sourceId: () => 's', onActive: () => {},
      binding: () => ({ key: { code: 185, name: 'F15' }, modifier: null }),
    })
    await ctl.enable()
    expect(bound).toEqual({ key: { code: 185, name: 'F15' }, modifier: null })
  })

  it('available() proxies the portal and is false on error', async () => {
    expect(await harness({ availableResult: true }).ctl.available()).toBe(true)
    const broken = new PttController({
      portal: { available: async () => { throw new Error('no bus') }, bind: async () => { throw new Error('x') } },
      exec: async () => {}, sourceId: () => 's', onActive: () => {}, binding: () => ({ key: { code: 188, name: 'F18' }, modifier: null }),
    })
    expect(await broken.available()).toBe(false)
  })
})

describe('PttController.rearmSource', () => {
  it('unmutes the previous source and baseline-mutes the current one while enabled', async () => {
    const h = harness()
    await h.ctl.enable()
    await h.ctl.rearmSource('old-scarlett-source')
    expect(h.mutes.slice(-2)).toEqual([
      'set-source-mute old-scarlett-source 0',
      'set-source-mute @DEFAULT_SOURCE@ 1',
    ])
  })

  it('is a no-op when PTT is disabled', async () => {
    const h = harness()
    await h.ctl.rearmSource('old-scarlett-source')
    expect(h.mutes).toEqual([])
  })
})
