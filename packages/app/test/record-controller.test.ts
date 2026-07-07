import { describe, it, expect, vi } from 'vitest'
import { RecordController } from '../src/main/RecordController.js'

function harness(overrides: Record<string, any> = {}) {
  const calls: { req: string; data: any }[] = []
  const client = {
    call: vi.fn(async (req: string, data?: any) => {
      calls.push({ req, data })
      if (req in overrides) {
        const v = overrides[req]
        if (v instanceof Error) throw v
        return v
      }
      if (req === 'StopRecord') return { outputPath: '/tmp/clip.mp4' }
      if (req === 'GetRecordStatus') return { outputActive: true }
      return {}
    }),
  }
  const sleeps: number[] = []
  const ctl = new RecordController({ client: () => client, sleep: async (ms) => { sleeps.push(ms) } })
  return { calls, sleeps, ctl }
}

describe('RecordController.recordTestClip', () => {
  it('sets record params, records for the duration, and returns the clip path', async () => {
    const h = harness()
    const r = await h.ctl.recordTestClip(6000, '/tmp/axitest')
    expect(r).toEqual({ ok: true, outputPath: '/tmp/clip.mp4' })
    const params = h.calls.filter((c) => c.req === 'SetProfileParameter').map((c) => c.data)
    expect(params).toEqual([
      { parameterCategory: 'SimpleOutput', parameterName: 'FilePath', parameterValue: '/tmp/axitest' },
      { parameterCategory: 'SimpleOutput', parameterName: 'RecFormat2', parameterValue: 'fragmented_mp4' },
      { parameterCategory: 'SimpleOutput', parameterName: 'RecQuality', parameterValue: 'Stream' },
    ])
    const order = h.calls.map((c) => c.req)
    expect(order.indexOf('StartRecord')).toBeGreaterThan(order.lastIndexOf('SetProfileParameter'))
    expect(order.indexOf('StopRecord')).toBeGreaterThan(order.indexOf('StartRecord'))
    expect(h.sleeps).toEqual([300, 6000])
  })

  it('fails fast when the record output never becomes active', async () => {
    // A FilePath OBS cannot write (e.g. a dir missing inside its flatpak
    // namespace) kills the output right after StartRecord is accepted.
    const h = harness({ GetRecordStatus: { outputActive: false } })
    const r = await h.ctl.recordTestClip(6000, '/tmp/x')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/did not start/i)
    expect(h.calls.some((c) => c.req === 'StopRecord')).toBe(false)
    expect(h.sleeps).toEqual([300])
  })

  it('a profile-param failure aborts before StartRecord', async () => {
    const h = harness({ SetProfileParameter: new Error('no profile') })
    const r = await h.ctl.recordTestClip(6000, '/tmp/x')
    expect(r.ok).toBe(false)
    expect(h.calls.some((c) => c.req === 'StartRecord')).toBe(false)
  })

  it('a StartRecord failure returns an error and never calls StopRecord', async () => {
    const h = harness({ StartRecord: new Error('output busy') })
    const r = await h.ctl.recordTestClip(6000, '/tmp/x')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('output busy')
    expect(h.calls.some((c) => c.req === 'StopRecord')).toBe(false)
  })

  it('a StopRecord failure is retried once, then errors without throwing', async () => {
    let stops = 0
    const client = {
      call: vi.fn(async (req: string) => {
        if (req === 'StopRecord') { stops++; throw new Error('stop failed') }
        if (req === 'GetRecordStatus') return { outputActive: true }
        return {}
      }),
    }
    const ctl = new RecordController({ client: () => client, sleep: async () => {} })
    const r = await ctl.recordTestClip(6000, '/tmp/x')
    expect(r.ok).toBe(false)
    expect(stops).toBe(2)
  })

  it('missing outputPath in the StopRecord response is an error', async () => {
    const h = harness({ StopRecord: {} })
    const r = await h.ctl.recordTestClip(6000, '/tmp/x')
    expect(r.ok).toBe(false)
  })
})
