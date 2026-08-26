// packages/app/test/ptt-controller.test.ts
import { describe, it, expect, vi } from 'vitest'
import { PttController, type MuteOps } from '../src/main/PttController.js'
import { createWin32MuteOps } from '../src/main/win32-mute-ops.js'

function harness(opts: { muteError?: boolean; availableResult?: boolean } = {}) {
  const mutes: string[] = []
  const actives: boolean[] = []
  const muteOps: MuteOps = {
    mute: vi.fn(async (muted: boolean) => {
      if (opts.muteError) throw new Error('mute failed')
      mutes.push(`mute:${muted ? '1' : '0'}`)
    }),
    unmuteById: vi.fn(async (id: string) => {
      if (opts.muteError) throw new Error('mute failed')
      mutes.push(`unmute:${id}`)
    }),
  }
  const ctl = new PttController({
    muteOps,
    onActive: (a) => actives.push(a),
    available: vi.fn(async () => opts.availableResult ?? true),
  })
  return { ctl, mutes, actives }
}

describe('PttController', () => {
  it('arm mutes the source (PTT baseline = muted)', async () => {
    const h = harness()
    await h.ctl.arm()
    expect(h.ctl.isEnabled()).toBe(true)
    expect(h.mutes).toEqual(['mute:1'])
  })

  it('onEdge(true) unmutes + reports active; onEdge(false) mutes + reports inactive', async () => {
    const h = harness()
    await h.ctl.arm()
    h.ctl.onEdge(true)
    await new Promise((r) => setTimeout(r, 0))
    h.ctl.onEdge(false)
    await new Promise((r) => setTimeout(r, 0))
    expect(h.mutes).toEqual(['mute:1', 'mute:0', 'mute:1'])
    expect(h.actives).toEqual([true, false])
  })

  it('onEdge is ignored while disarmed', async () => {
    const h = harness()
    h.ctl.onEdge(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(h.mutes).toEqual([])
    expect(h.actives).toEqual([])
  })

  it('disarm UNMUTES (never strand the user muted)', async () => {
    const h = harness()
    await h.ctl.arm()
    await h.ctl.disarm()
    expect(h.ctl.isEnabled()).toBe(false)
    expect(h.mutes[h.mutes.length - 1]).toBe('mute:0')
    expect(h.actives[h.actives.length - 1]).toBe(false)
  })

  it('restore unconditionally unmutes (crash recovery)', async () => {
    const h = harness()
    await h.ctl.restore()
    expect(h.mutes).toEqual(['mute:0'])
  })

  it('mute failures are swallowed (never throw out)', async () => {
    const h = harness({ muteError: true })
    await expect(h.ctl.arm()).resolves.toBeUndefined()
    await expect(h.ctl.disarm()).resolves.toBeUndefined()
    await expect(h.ctl.restore()).resolves.toBeUndefined()
  })

  it('arm is NOT idempotent — a rebuild re-applies the baseline mute every time', async () => {
    // Unlike the old bind-based enable(), arm() is cheap (no dbus/portal
    // round trip) and HotkeyService calls it after every hotkey rebuild —
    // including rebuilds unrelated to PTT — as a safety net for the gap
    // where no hotkey is live. It deliberately re-mutes each call.
    const h = harness()
    await h.ctl.arm()
    await h.ctl.arm()
    expect(h.mutes).toEqual(['mute:1', 'mute:1'])
  })

  it('disarm is a no-op when already disarmed', async () => {
    const h = harness()
    await h.ctl.disarm()
    expect(h.mutes).toEqual([])
  })

  it('available() proxies the dep and is false on error', async () => {
    expect(await harness({ availableResult: true }).ctl.available()).toBe(true)
    const broken = new PttController({
      muteOps: { mute: async () => {}, unmuteById: async () => {} },
      onActive: () => {},
      available: async () => { throw new Error('no bus') },
    })
    expect(await broken.available()).toBe(false)
  })
})

describe('PttController.rearmSource', () => {
  it('unmutes the previous source and baseline-mutes the current one while enabled', async () => {
    const h = harness()
    await h.ctl.arm()
    await h.ctl.rearmSource('old-scarlett-source')
    expect(h.mutes.slice(-2)).toEqual([
      'unmute:old-scarlett-source',
      'mute:1',
    ])
  })

  it('is a no-op when PTT is disabled', async () => {
    const h = harness()
    await h.ctl.rearmSource('old-scarlett-source')
    expect(h.mutes).toEqual([])
  })
})

describe('Linux pactl muteOps', () => {
  it('mute issues set-source-mute <id> 1 and unmute issues set-source-mute <id> 0', async () => {
    // Minimal sanity check that the pactl muteOps (constructed in index.ts) are
    // structurally correct — tested via a local mimic of the same closure shape.
    const calls: string[] = []
    const execAsync = async (_cmd: string, args: string[]) => { calls.push(args.join(' ')) }
    const sourceId = () => '@DEFAULT_SOURCE@'
    const warn = (msg: string, ...args: unknown[]) => console.warn(msg, ...args)
    const linuxMuteOps: MuteOps = {
      mute: (m) => execAsync('pactl', ['set-source-mute', sourceId(), m ? '1' : '0']).catch(warn),
      unmuteById: (id) => execAsync('pactl', ['set-source-mute', id, '0']).catch(warn),
    }
    await linuxMuteOps.mute(true)
    await linuxMuteOps.mute(false)
    await linuxMuteOps.unmuteById('alsa_input.usb_scarlett')
    expect(calls).toEqual([
      'set-source-mute @DEFAULT_SOURCE@ 1',
      'set-source-mute @DEFAULT_SOURCE@ 0',
      'set-source-mute alsa_input.usb_scarlett 0',
    ])
  })
})

describe('win32 muteOps (createWin32MuteOps)', () => {
  it('mute(true) calls SetInputMute on AxiStream Mic with inputMuted=true', async () => {
    const calls: Array<{ req: string; data?: unknown }> = []
    const ops = createWin32MuteOps({ call: async (req, data) => { calls.push({ req, data }) } })
    await ops.mute(true)
    expect(calls).toEqual([{ req: 'SetInputMute', data: { inputName: 'AxiStream Mic', inputMuted: true } }])
  })

  it('mute(false) calls SetInputMute on AxiStream Mic with inputMuted=false', async () => {
    const calls: Array<{ req: string; data?: unknown }> = []
    const ops = createWin32MuteOps({ call: async (req, data) => { calls.push({ req, data }) } })
    await ops.mute(false)
    expect(calls).toEqual([{ req: 'SetInputMute', data: { inputName: 'AxiStream Mic', inputMuted: false } }])
  })

  it('unmuteById calls SetInputMute with inputMuted=false (device id ignored)', async () => {
    const calls: Array<{ req: string; data?: unknown }> = []
    const ops = createWin32MuteOps({ call: async (req, data) => { calls.push({ req, data }) } })
    await ops.unmuteById('some-device-id')
    expect(calls).toEqual([{ req: 'SetInputMute', data: { inputName: 'AxiStream Mic', inputMuted: false } }])
  })

  it('swallows OBS call failures (best-effort, never throw)', async () => {
    const ops = createWin32MuteOps({ call: async () => { throw new Error('OBS offline') } })
    await expect(ops.mute(true)).resolves.toBeUndefined()
    await expect(ops.mute(false)).resolves.toBeUndefined()
    await expect(ops.unmuteById('x')).resolves.toBeUndefined()
  })
})
