import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenStore } from '../src/main/TokenStore.js'
import { YouTubeAuth } from '../src/main/YouTubeAuth.js'

const safe = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString('utf8') }

let store: TokenStore
beforeEach(() => { store = new TokenStore(join(mkdtempSync(join(tmpdir(), 'axi-')), 'yt.bin'), safe) })

describe('YouTubeAuth.connect', () => {
  it('runs PKCE, exchanges code, persists tokens', async () => {
    let openedUrl = ''
    const lb: any = {
      redirectUri: 'http://127.0.0.1:9999/callback',
      waitForCode: async () => {
        const u = new URL(openedUrl)
        return { code: 'CODE', state: u.searchParams.get('state')! }
      },
      close: vi.fn(),
    }
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }), text: async () => '' })) as any
    const auth = new YouTubeAuth({
      store,
      config: { clientId: 'cid', clientSecret: 'sec' },
      fetchFn,
      openExternal: async (url: string) => { openedUrl = url },
      listen: async () => lb,
    })
    await auth.connect()
    expect(auth.isConnected()).toBe(true)
    expect(store.load()!.refreshToken).toBe('RT')
    // PKCE params present in auth url
    const u = new URL(openedUrl)
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('code_challenge')).toBeTruthy()
  })

  it('rejects with /timed out/i when waitForCode never resolves', async () => {
    const closeFn = vi.fn()
    const lb: any = {
      redirectUri: 'http://127.0.0.1:9999/callback',
      waitForCode: () => new Promise<never>(() => {}),
      close: closeFn,
    }
    const auth = new YouTubeAuth({
      store,
      config: { clientId: 'cid', clientSecret: 'sec' },
      fetchFn: vi.fn() as any,
      connectTimeoutMs: 20,
      openExternal: async () => {},
      listen: async () => lb,
    })
    await expect(auth.connect()).rejects.toThrow(/timed out/i)
    expect(closeFn).toHaveBeenCalled()
  })

  it('rejects with /already in progress/i on concurrent connect()', async () => {
    const lb: any = {
      redirectUri: 'http://127.0.0.1:9999/callback',
      waitForCode: () => new Promise<never>(() => {}),
      close: vi.fn(),
    }
    const auth = new YouTubeAuth({
      store,
      config: { clientId: 'cid', clientSecret: 'sec' },
      fetchFn: vi.fn() as any,
      connectTimeoutMs: 50,
      openExternal: async () => {},
      listen: async () => lb,
    })
    const first = auth.connect()
    await expect(auth.connect()).rejects.toThrow(/already in progress/i)
    // let first settle so we don't leak the timer
    await first.catch(() => {})
  })

  it('throws on CSRF state mismatch', async () => {
    let openedUrl = ''
    const lb: any = {
      redirectUri: 'http://127.0.0.1:9999/callback',
      waitForCode: async () => ({ code: 'CODE', state: 'tampered' }),
      close: vi.fn(),
    }
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }), text: async () => '' })) as any
    const auth = new YouTubeAuth({
      store,
      config: { clientId: 'cid', clientSecret: 'sec' },
      fetchFn,
      openExternal: async (url: string) => { openedUrl = url },
      listen: async () => lb,
    })
    await expect(auth.connect()).rejects.toThrow(/state mismatch/i)
  })
})

describe('YouTubeAuth.accessToken', () => {
  it('refreshes when expired', async () => {
    store.save({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: 0, channelTitle: null })
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'NEW', expires_in: 3600 }), text: async () => '' })) as any
    const auth = new YouTubeAuth({ store, config: { clientId: 'cid', clientSecret: 'sec' }, fetchFn, openExternal: async () => {}, listen: async () => ({} as any) })
    expect(await auth.accessToken()).toBe('NEW')
    expect(store.load()!.refreshToken).toBe('RT') // preserved
  })

  it('returns cached token when still valid', async () => {
    store.save({ accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3_600_000, channelTitle: null })
    const fetchFn = vi.fn() as any
    const auth = new YouTubeAuth({ store, config: { clientId: 'cid', clientSecret: 'sec' }, fetchFn, openExternal: async () => {}, listen: async () => ({} as any) })
    expect(await auth.accessToken()).toBe('AT')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('throws when not connected', async () => {
    const auth = new YouTubeAuth({ store, config: { clientId: 'cid', clientSecret: 'sec' }, fetchFn: vi.fn() as any, openExternal: async () => {}, listen: async () => ({} as any) })
    await expect(auth.accessToken()).rejects.toThrow(/not connected/i)
  })
})
