import { describe, it, expect, vi } from 'vitest'
import { ObsSidecar } from '../src/obs-sidecar.js'
import type { ObsLauncher, ObsLaunchHandle } from '../src/obs-launcher.js'

function fakeLauncher(): { launcher: ObsLauncher; exit: (code: number | null) => void } {
  let exitCb: (code: number | null) => void = () => {}
  const handle: ObsLaunchHandle = { kill: vi.fn(), onExit: (cb) => { exitCb = cb } }
  const launcher: ObsLauncher = { launch: vi.fn(() => handle), killApp: vi.fn() }
  return { launcher, exit: (c) => exitCb(c) }
}

describe('ObsSidecar', () => {
  it('start() launches with the collection + websocket flags and connects', async () => {
    const { launcher } = fakeLauncher()
    const fakeClient = { connect: vi.fn().mockResolvedValue({}), disconnect: vi.fn().mockResolvedValue(undefined) }
    const sidecar = new ObsSidecar({
      launcher, collection: 'AxiStream',
      // test seams:
      _waitForPort: vi.fn().mockResolvedValue(undefined),
      _makeClient: () => fakeClient as any,
    } as any)
    await sidecar.start()
    const args = (launcher.launch as any).mock.calls[0][0] as string[]
    expect(args).toContain('--collection')
    expect(args).toContain('AxiStream')
    expect(args).toContain('--websocket_port')
    const portIdx = args.indexOf('--websocket_port')
    expect(Number(args[portIdx + 1])).toBeGreaterThan(0)
    expect(fakeClient.connect).toHaveBeenCalledOnce()
  })

  it('emits "crashed" when the process exits unexpectedly', async () => {
    const { launcher, exit } = fakeLauncher()
    const fakeClient = { connect: vi.fn().mockResolvedValue({}), disconnect: vi.fn().mockResolvedValue(undefined) }
    const sidecar = new ObsSidecar({
      launcher, collection: 'AxiStream',
      _waitForPort: vi.fn().mockResolvedValue(undefined),
      _makeClient: () => fakeClient as any,
    } as any)
    const onCrash = vi.fn()
    sidecar.on('crashed', onCrash)
    await sidecar.start()
    exit(1)
    expect(onCrash).toHaveBeenCalledOnce()
  })

  it('stop() kills the app via the launcher', async () => {
    const { launcher } = fakeLauncher()
    const fakeClient = { connect: vi.fn().mockResolvedValue({}), disconnect: vi.fn().mockResolvedValue(undefined) }
    const sidecar = new ObsSidecar({
      launcher, collection: 'AxiStream',
      _waitForPort: vi.fn().mockResolvedValue(undefined),
      _makeClient: () => fakeClient as any,
    } as any)
    await sidecar.start()
    await sidecar.stop()
    expect(launcher.killApp).toHaveBeenCalled()
  })
})
