import { describe, expect, it, vi } from 'vitest'
import { OwnedObsSidecar } from '../src/owned-obs-sidecar.js'

describe('OwnedObsSidecar', () => {
  it('prepares the owned runtime before constructing and starting ObsSidecar', async () => {
    const order: string[] = []
    const runtime = {
      prepare: vi.fn(async () => { order.push('prepare'); return { launcher: {}, expectedObsVersion: '32.1.2', engineId: 'owned' } }),
    }
    const inner = { start: vi.fn(async () => { order.push('start') }), on: vi.fn() }
    const makeSidecar = vi.fn(() => { order.push('construct'); return inner as never })
    const sidecar = new OwnedObsSidecar({ runtime: runtime as never, collection: 'AxiStream', makeSidecar })

    await sidecar.start()

    expect(order).toEqual(['prepare', 'construct', 'start'])
    expect(makeSidecar).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'AxiStream', expectedObsVersion: '32.1.2', launcher: {},
    }))
  })

  it('constructs no sidecar when ownership preparation fails', async () => {
    const runtime = { prepare: vi.fn().mockRejectedValue(new Error('runtime unverifiable')) }
    const makeSidecar = vi.fn()
    const sidecar = new OwnedObsSidecar({ runtime: runtime as never, collection: 'AxiStream', makeSidecar })

    await expect(sidecar.start()).rejects.toThrow('runtime unverifiable')
    expect(makeSidecar).not.toHaveBeenCalled()
  })

  it('forwards crash listeners and lifecycle only to the prepared sidecar', async () => {
    const callback = vi.fn()
    const inner = {
      start: vi.fn(), stop: vi.fn(), restart: vi.fn(), on: vi.fn(),
      client: vi.fn(() => ({ owned: true })), wsInfo: vi.fn(() => ({ url: 'owned', password: 'secret' })),
    }
    const runtime = { prepare: vi.fn(async () => ({ launcher: {}, expectedObsVersion: '32.1.2', engineId: 'owned' })) }
    const sidecar = new OwnedObsSidecar({ runtime: runtime as never, collection: 'AxiStream', makeSidecar: () => inner as never })
    sidecar.on('crashed', callback)
    await sidecar.start()

    expect(inner.on).toHaveBeenCalledWith('crashed', callback)
    expect(sidecar.client()).toEqual({ owned: true })
    expect(sidecar.wsInfo()).toEqual({ url: 'owned', password: 'secret' })
    await sidecar.restart()
    await sidecar.stop()
    expect(inner.restart).toHaveBeenCalledOnce()
    expect(inner.stop).toHaveBeenCalledOnce()
  })
})
