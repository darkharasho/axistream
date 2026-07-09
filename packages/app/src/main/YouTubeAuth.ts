import { TokenStore, type OAuthTokens } from './TokenStore.js'
import { createPkce, randomState } from './pkce.js'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl'

export interface AuthConfig { clientId: string; clientSecret: string }

export interface LoopbackResult {
  redirectUri: string
  waitForCode(): Promise<{ code: string; state: string }>
  close(): void
}

export interface YouTubeAuthDeps {
  store: TokenStore
  config: AuthConfig
  fetchFn?: typeof fetch
  connectTimeoutMs?: number
  openExternal(url: string): Promise<void>
  listen(): Promise<LoopbackResult>
}

export class YouTubeAuth {
  private readonly f: typeof fetch
  private readonly connectTimeoutMs: number
  private connecting = false
  constructor(private readonly d: YouTubeAuthDeps) {
    this.f = d.fetchFn ?? fetch
    this.connectTimeoutMs = d.connectTimeoutMs ?? 300_000
  }

  isConnected(): boolean { return this.d.store.load() !== null }
  channelTitle(): string | null { return this.d.store.load()?.channelTitle ?? null }
  disconnect(): void { this.d.store.forget() }

  async connect(): Promise<void> {
    if (!this.d.config.clientId) {
      // Packaged builds bake AXI_YT_CLIENT_ID in at build time; if it's blank
      // the build was made without the credential and Google returns a 400
      // "Missing required parameter: client_id" on a broken consent page.
      // Fail loudly here instead of launching that dead-end.
      throw new Error('YouTube sign-in is not configured in this build (missing OAuth client_id).')
    }
    if (this.connecting) throw new Error('OAuth already in progress')
    this.connecting = true
    try {
      const { verifier, challenge } = createPkce()
      const state = randomState()
      const lb = await this.d.listen()
      try {
        const url = new URL(AUTH_URL)
        url.search = new URLSearchParams({
          client_id: this.d.config.clientId,
          redirect_uri: lb.redirectUri,
          response_type: 'code',
          scope: SCOPE,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
          access_type: 'offline',
          prompt: 'consent',
        }).toString()
        await this.d.openExternal(url.toString())
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined
        const codePromise = lb.waitForCode()
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('OAuth timed out')), this.connectTimeoutMs)
        })
        const got = await Promise.race([codePromise, timeoutPromise]).finally(() => clearTimeout(timeoutHandle))
        if (got.state !== state) throw new Error('OAuth state mismatch')
        const tok = await this.exchange({
          grant_type: 'authorization_code',
          code: got.code,
          code_verifier: verifier,
          redirect_uri: lb.redirectUri,
        })
        if (!tok.refresh_token) throw new Error('OAuth response missing refresh_token')
        this.d.store.save({
          accessToken: tok.access_token,
          refreshToken: tok.refresh_token,
          expiresAt: Date.now() + tok.expires_in * 1000,
          channelTitle: null,
        })
      } finally {
        lb.close()
      }
    } finally {
      this.connecting = false
    }
  }

  async accessToken(): Promise<string> {
    const t = this.d.store.load()
    if (!t) throw new Error('YouTube not connected')
    if (Date.now() < t.expiresAt - 60_000) return t.accessToken
    const tok = await this.exchange({ grant_type: 'refresh_token', refresh_token: t.refreshToken })
    const next: OAuthTokens = {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? t.refreshToken,
      expiresAt: Date.now() + tok.expires_in * 1000,
      channelTitle: t.channelTitle,
    }
    this.d.store.save(next)
    return next.accessToken
  }

  setChannelTitle(title: string | null): void {
    const t = this.d.store.load()
    if (t) this.d.store.save({ ...t, channelTitle: title })
  }

  private async exchange(extra: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
    const body = new URLSearchParams({
      client_id: this.d.config.clientId,
      client_secret: this.d.config.clientSecret,
      ...extra,
    })
    const res = await this.f(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) throw new Error(`OAuth token exchange failed: ${res.status} ${await res.text()}`)
    return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number }>
  }
}
