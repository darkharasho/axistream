import { describe, it, expect, vi } from 'vitest'
import { AudioLevelMeter } from '../src/main/AudioLevelMeter.js'

function fakeClient() {
  const handlers: Record<string, (d: any) => void> = {}
  return {
    connectArgs: [] as any[],
    connect: vi.fn(async function (this: any, ...args: any[]) { (this as any).connectArgs.push(args) }),
    disconnect: vi.fn(async () => {}),
    on: vi.fn((ev: string, cb: (d: any) => void) => { handlers[ev] = cb }),
    emit: (ev: string, d: any) => handlers[ev]?.(d),
  }
}

const meters = (name: string, mul: number) => ({ inputName: name, inputLevelsMul: [[mul, mul, mul], [mul / 2, 0, 0]] })

describe('AudioLevelMeter', () => {
  it('connects with the volmeter subscription and maps the three inputs (max across channels)', async () => {
    const c = fakeClient()
    const pushes: any[] = []
    const m = new AudioLevelMeter({ info: () => ({ url: 'ws://x', password: 'p' }), onLevels: (l) => pushes.push(l), makeClient: () => c as any, throttleMs: 0 })
    m.start()
    await new Promise((r) => setTimeout(r, 5))
    expect(c.connect).toHaveBeenCalled()
    const [, , opts] = (c.connect.mock.calls[0] as any[])
    expect(opts.eventSubscriptions).toBeGreaterThan(0) // InputVolumeMeters flag
    c.emit('InputVolumeMeters', { inputs: [meters('AxiStream Desktop Audio', 0.5), meters('AxiStream Mic', 0.2), meters('AxiStream Game Audio', 0.9), meters('Something Else', 1)] })
    expect(pushes[0]).toEqual({ desktop: 0.5, mic: 0.2, game: 0.9 })
    await m.stop()
  })

  it('missing inputs report 0 and values clamp to 1', async () => {
    const c = fakeClient()
    const pushes: any[] = []
    const m = new AudioLevelMeter({ info: () => ({ url: 'ws://x', password: 'p' }), onLevels: (l) => pushes.push(l), makeClient: () => c as any, throttleMs: 0 })
    m.start(); await new Promise((r) => setTimeout(r, 5))
    c.emit('InputVolumeMeters', { inputs: [meters('AxiStream Mic', 4)] })
    expect(pushes[0]).toEqual({ desktop: 0, mic: 1, game: 0 })
    await m.stop()
  })

  it('throttles pushes closer than throttleMs', async () => {
    const c = fakeClient()
    const pushes: any[] = []
    const m = new AudioLevelMeter({ info: () => ({ url: 'ws://x', password: 'p' }), onLevels: (l) => pushes.push(l), makeClient: () => c as any, throttleMs: 10000 })
    m.start(); await new Promise((r) => setTimeout(r, 5))
    c.emit('InputVolumeMeters', { inputs: [meters('AxiStream Mic', 0.5)] })
    c.emit('InputVolumeMeters', { inputs: [meters('AxiStream Mic', 0.6)] })
    expect(pushes).toHaveLength(1)
    await m.stop()
  })

  it('null info → start is a quiet no-op retry loop; stop ends it', async () => {
    const c = fakeClient()
    const m = new AudioLevelMeter({ info: () => null, onLevels: () => {}, makeClient: () => c as any, backoffMs: 5 })
    m.start(); await new Promise((r) => setTimeout(r, 20))
    expect(c.connect).not.toHaveBeenCalled()
    await m.stop()
  })
})
