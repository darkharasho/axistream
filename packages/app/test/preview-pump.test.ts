import { describe, it, expect, vi } from 'vitest'
import { PreviewPump } from '../src/main/PreviewPump.js'

describe('PreviewPump', () => {
  it('emits frames on an interval and stops cleanly', async () => {
    const client = { call: vi.fn(async () => ({ imageData: 'data:image/png;base64,AAAA' })) }
    const frames: string[] = []
    const pump = new PreviewPump({ client: () => client, sourceName: 'AxiStream Capture', emit: (d) => frames.push(d), intervalMs: 5 })
    pump.start()
    await new Promise((r) => setTimeout(r, 24))
    pump.stop()
    const n = frames.length
    expect(n).toBeGreaterThanOrEqual(2)
    await new Promise((r) => setTimeout(r, 15))
    expect(frames.length).toBe(n) // no frames after stop
  })

  it('does not emit while hidden', async () => {
    const client = { call: vi.fn(async () => ({ imageData: 'data:image/png;base64,AAAA' })) }
    const frames: string[] = []
    const pump = new PreviewPump({ client: () => client, sourceName: 'AxiStream Capture', emit: (d) => frames.push(d), intervalMs: 5 })
    pump.start(); pump.setVisible(false)
    await new Promise((r) => setTimeout(r, 24))
    expect(frames.length).toBe(0)
    pump.stop()
  })
})
