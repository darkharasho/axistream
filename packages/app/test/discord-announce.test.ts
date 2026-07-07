// packages/app/test/discord-announce.test.ts
import { describe, it, expect, vi } from 'vitest'
import { announce, type FetchLike } from '../src/main/DiscordAnnounce.js'

const base = { webhookUrl: 'https://discord.com/api/webhooks/1/abc', title: 'WvW Raid', watchUrl: 'https://www.youtube.com/watch?v=xyz' }

describe('announce', () => {
  it('posts content + embed as JSON when a message is set', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => ({ ok: true, status: 204 }))
    const r = await announce({ ...base, message: '@here raid starting' }, fetchFn)
    expect(r).toEqual({ ok: true })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(base.webhookUrl)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body)
    expect(body.content).toBe('@here raid starting')
    expect(body.embeds[0]).toMatchObject({ title: 'WvW Raid', url: base.watchUrl, color: 16711680 })
  })

  it('omits content when the message is empty', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => ({ ok: true, status: 204 }))
    await announce({ ...base, message: '   ' }, fetchFn)
    const body = JSON.parse(fetchFn.mock.calls[0][1].body)
    expect('content' in body).toBe(false)
    expect(body.embeds).toHaveLength(1)
  })

  it('makes no network call when the webhook is empty', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => ({ ok: true, status: 204 }))
    const r = await announce({ ...base, webhookUrl: '  ' }, fetchFn)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(r.ok).toBe(false)
  })

  it('returns an error result on a non-2xx response (no throw)', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => ({ ok: false, status: 404 }))
    const r = await announce({ ...base }, fetchFn)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('404')
  })

  it('returns an error result when fetch rejects (no throw)', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => { throw new Error('network down') })
    const r = await announce({ ...base }, fetchFn)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('network down')
  })
})
