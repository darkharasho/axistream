import { describe, it, expect, vi } from 'vitest'
import { ObsSidecar, ObsVersionMismatchError } from '../src/obs-sidecar.js'
import type { ObsLauncher, ObsLaunchHandle } from '../src/obs-launcher.js'

function fakeLauncher(): { launcher: ObsLauncher; exit: (code: number | null) => void } {
  let exitCb: (code: number | null) => void = () => {}
  const handle: ObsLaunchHandle = { kill: vi.fn(), onExit: (cb) => { exitCb = cb } }
  const launcher: ObsLauncher = { launch: vi.fn(() => handle), stopOwned: vi.fn() }
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
    expect(args).not.toContain('--disable-shutdown-check')
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

  it('stop() stops only the owned app via the launcher', async () => {
    const { launcher } = fakeLauncher()
    const fakeClient = { connect: vi.fn().mockResolvedValue({}), disconnect: vi.fn().mockResolvedValue(undefined) }
    const sidecar = new ObsSidecar({
      launcher, collection: 'AxiStream',
      _waitForPort: vi.fn().mockResolvedValue(undefined),
      _makeClient: () => fakeClient as any,
    } as any)
    await sidecar.start()
    await sidecar.stop()
    expect(launcher.stopOwned).toHaveBeenCalledOnce()
  })

  it('stop() suppresses the "crashed" event when OBS exits after intentional teardown', async () => {
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
    await sidecar.stop()
    exit(0) // OBS exits as a result of the kill — should NOT emit 'crashed'
    expect(onCrash).not.toHaveBeenCalled()
  })
})

describe('ObsSidecar wsInfo', () => {
  it('wsInfo is null before start and carries url+password after', async () => {
    const { launcher } = fakeLauncher()
    const fakeClient = { connect: vi.fn().mockResolvedValue({}), disconnect: vi.fn().mockResolvedValue(undefined) }
    const sc = new ObsSidecar({
      launcher, collection: 'AxiStream',
      _waitForPort: vi.fn().mockResolvedValue(undefined),
      _makeClient: () => fakeClient as any,
    } as any)
    expect(sc.wsInfo()).toBeNull()
    await sc.start()
    const info = sc.wsInfo()!
    expect(info.url).toBe(`ws://127.0.0.1:${sc.port}`)
    expect(typeof info.password).toBe('string')
  })
})

describe('ObsSidecar robustness', () => {
  function setup(overrides: any = {}) {
    let exitCb: (c: number | null) => void = () => {}
    const handle = { kill: vi.fn(), onExit: (cb: any) => { exitCb = cb } }
    const launcher = { launch: vi.fn(() => handle), stopOwned: vi.fn() }
    const client = {
      connect: vi.fn().mockResolvedValue({}),
      disconnect: vi.fn().mockResolvedValue(undefined),
      call: vi.fn().mockResolvedValue({ obsVersion: '32.1.2' }),
    }
    const sidecar = new ObsSidecar({
      launcher: launcher as any, collection: 'AxiStream',
      _waitForPort: vi.fn().mockResolvedValue(undefined),
      _makeClient: () => client as any,
      ...overrides,
    } as any)
    return { sidecar, launcher, client, exit: (c: number | null) => exitCb(c) }
  }

  it('does not perform global orphan cleanup before launching', async () => {
    const { sidecar, launcher } = setup()
    await sidecar.start()
    expect(launcher.stopOwned).not.toHaveBeenCalled()
  })

  it('throws ObsVersionMismatchError when version differs', async () => {
    const { sidecar } = setup({ expectedObsVersion: '99.9.9' })
    await expect(sidecar.start()).rejects.toBeInstanceOf(ObsVersionMismatchError)
  })

  it('accepts the expected version', async () => {
    const { sidecar } = setup({ expectedObsVersion: '32.1.2' })
    await expect(sidecar.start()).resolves.toBeUndefined()
  })
})
