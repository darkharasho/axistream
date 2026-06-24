import type { Privacy } from './StreamSettings.js'

const BASE = 'https://www.googleapis.com/youtube/v3'

export interface Ingest { server: string; key: string }
export interface LiveSession { broadcastId: string; streamId: string; ingest: Ingest }

export interface YouTubeLiveDeps {
  accessToken(): Promise<string>
  fetchFn?: typeof fetch
}

export class YouTubeLive {
  private readonly f: typeof fetch
  constructor(private readonly d: YouTubeLiveDeps) {
    this.f = d.fetchFn ?? fetch
  }

  private async req(method: string, path: string, body?: unknown): Promise<any> {
    const token = await this.d.accessToken()
    const res = await this.f(`${BASE}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`YouTube API ${method} ${path} failed: ${res.status} ${await res.text()}`)
    return res.json()
  }

  async channelTitle(): Promise<string | null> {
    const r = await this.req('GET', 'channels?part=snippet&mine=true')
    return r.items?.[0]?.snippet?.title ?? null
  }

  private async ensureStream(reuseStreamId: string | null): Promise<{ streamId: string; ingest: Ingest }> {
    if (reuseStreamId) {
      try {
        const r = await this.req('GET', `liveStreams?part=cdn&id=${reuseStreamId}`)
        const info = r.items?.[0]?.cdn?.ingestionInfo
        if (info?.rtmpsIngestionAddress && info?.streamName) {
          return { streamId: reuseStreamId, ingest: { server: info.rtmpsIngestionAddress, key: info.streamName } }
        }
      } catch { /* fall through to create */ }
    }
    const created = await this.req('POST', 'liveStreams?part=snippet,cdn', {
      snippet: { title: 'AxiStream' },
      cdn: { ingestionType: 'rtmp', frameRate: 'variable', resolution: 'variable' },
    })
    const info = created.cdn.ingestionInfo
    return { streamId: created.id, ingest: { server: info.rtmpsIngestionAddress, key: info.streamName } }
  }

  async startSession(opts: { title: string; privacy: Privacy; reuseStreamId: string | null; now: Date }): Promise<LiveSession> {
    const broadcast = await this.req('POST', 'liveBroadcasts?part=snippet,status,contentDetails', {
      snippet: { title: opts.title, scheduledStartTime: opts.now.toISOString() },
      status: { privacyStatus: opts.privacy, selfDeclaredMadeForKids: false },
      contentDetails: { enableAutoStart: true, enableAutoStop: true, monitorStream: { enableMonitorStream: false } },
    })
    const { streamId, ingest } = await this.ensureStream(opts.reuseStreamId)
    await this.req('POST', `liveBroadcasts/bind?id=${broadcast.id}&streamId=${streamId}&part=id,contentDetails`)
    return { broadcastId: broadcast.id, streamId, ingest }
  }

  async confirmLive(broadcastId: string): Promise<boolean> {
    const r = await this.req('GET', `liveBroadcasts?part=status&id=${broadcastId}`)
    return r.items?.[0]?.status?.lifeCycleStatus === 'live'
  }

  async complete(broadcastId: string): Promise<void> {
    try { await this.req('POST', `liveBroadcasts/transition?broadcastStatus=complete&id=${broadcastId}&part=status`) }
    catch { /* best-effort cleanup */ }
  }
}
