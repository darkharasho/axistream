import { describe, it, expect, vi } from 'vitest'
import { YouTubeLive } from '../src/main/YouTubeLive.js'

// Minimal fake fetch router keyed by method+path fragment.
function fakeFetch(routes: Record<string, any>) {
  const calls: { url: string; method: string; body: any }[] = []
  const fn = vi.fn(async (url: string, init?: any) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body) : undefined
    calls.push({ url, method, body })
    const key = Object.keys(routes).find((k) => `${method} `.startsWith(k.split(' ')[0] + ' ') && url.includes(k.split(' ')[1]))
    const payload = key ? routes[key] : { error: 'no route' }
    return { ok: !!key, status: key ? 200 : 404, json: async () => payload, text: async () => JSON.stringify(payload) }
  })
  return { fn, calls }
}

const token = async () => 'AT'

describe('YouTubeLive.startSession', () => {
  it('creates broadcast + stream, binds, returns rtmps ingest', async () => {
    const { fn, calls } = fakeFetch({
      'POST liveBroadcasts?': { id: 'B1' },
      'POST liveStreams?': { id: 'S1', cdn: { ingestionInfo: { rtmpsIngestionAddress: 'rtmps://x/live2', streamName: 'KEY' } } },
      'POST liveBroadcasts/bind': { id: 'B1' },
    })
    const yt = new YouTubeLive({ accessToken: token, fetchFn: fn as any })
    const s = await yt.startSession({ title: 'T', privacy: 'public', reuseStreamId: null, now: new Date('2026-06-24T00:00:00Z') })
    expect(s).toEqual({ broadcastId: 'B1', streamId: 'S1', ingest: { server: 'rtmps://x/live2', key: 'KEY' } })
    // broadcast created with enableAutoStart
    const created = calls.find((c) => c.url.includes('liveBroadcasts?') && c.method === 'POST')
    expect(created!.body.contentDetails.enableAutoStart).toBe(true)
    expect(created!.body.status.privacyStatus).toBe('public')
    // bind referenced both ids
    expect(calls.some((c) => c.url.includes('bind') && c.url.includes('id=B1') && c.url.includes('streamId=S1'))).toBe(true)
  })

  it('throws on non-2xx', async () => {
    const fn = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => 'quotaExceeded' }))
    const yt = new YouTubeLive({ accessToken: token, fetchFn: fn as any })
    await expect(yt.startSession({ title: 'T', privacy: 'public', reuseStreamId: null, now: new Date() }))
      .rejects.toThrow(/403/)
  })
})

describe('YouTubeLive.confirmLive', () => {
  it('true when lifeCycleStatus is live', async () => {
    const fn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [{ status: { lifeCycleStatus: 'live' } }] }), text: async () => '' }))
    const yt = new YouTubeLive({ accessToken: token, fetchFn: fn as any })
    expect(await yt.confirmLive('B1')).toBe(true)
  })
})
