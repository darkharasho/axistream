import { EventEmitter } from 'node:events'
import { OBSWebSocket } from 'obs-websocket-js'
import { createConnection } from 'node:net'
import { findFreePort, type ObsLauncher, type ObsLaunchHandle } from './obs-launcher.js'

export class ObsVersionMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`OBS version mismatch: expected ${expected}, got ${actual}`)
    this.name = 'ObsVersionMismatchError'
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now()
  for (;;) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = createConnection(port, '127.0.0.1')
      s.once('connect', () => { s.destroy(); resolve(true) })
      s.once('error', () => { s.destroy(); resolve(false) })
    })
    if (ok) return
    if (Date.now() - start > timeoutMs) throw new Error(`OBS websocket port ${port} never opened`)
    await sleep(500)
  }
}

function randomPassword(): string {
  return 'axc-' + Math.abs(Date.now() ^ (process.pid << 8)).toString(36)
}

export interface ObsSidecarOptions {
  launcher: ObsLauncher
  collection: string
  password?: string
  expectedObsVersion?: string
  // test seams (optional):
  _waitForPort?: (port: number, timeoutMs: number) => Promise<void>
  _makeClient?: () => OBSWebSocket
}

export class ObsSidecar {
  private emitter = new EventEmitter()
  private handle?: ObsLaunchHandle
  private obs?: OBSWebSocket
  private _port = 0
  private expectExit = false
  private readonly password: string

  constructor(private readonly opts: ObsSidecarOptions) {
    this.password = opts.password ?? randomPassword()
  }

  get port(): number { return this._port }

  /** Connection info for auxiliary websocket connections (e.g. the audio
   *  level meter). Null until start(). */
  wsInfo(): { url: string; password: string } | null {
    if (!this.obs || !this._port) return null
    return { url: `ws://127.0.0.1:${this._port}`, password: this.password }
  }

  on(event: 'crashed', cb: () => void): void { this.emitter.on(event, cb) }

  client(): OBSWebSocket {
    if (!this.obs) throw new Error('ObsSidecar not started')
    return this.obs
  }

  async start(): Promise<void> {
    this._port = await findFreePort()
    this.expectExit = false
    const args = [
      '--websocket_port', String(this._port),
      '--websocket_password', this.password,
      '--websocket_debug',
      '--multi',
      '--collection', this.opts.collection,
    ]
    this.handle = this.opts.launcher.launch(args)
    this.handle.onExit(() => { if (!this.expectExit) this.emitter.emit('crashed') })

    try {
      const wait = this.opts._waitForPort ?? waitForPort
      await wait(this._port, 30000)

      this.obs = (this.opts._makeClient ?? (() => new OBSWebSocket()))()
      await this.obs.connect(`ws://127.0.0.1:${this._port}`, this.password)

      if (this.opts.expectedObsVersion) {
        const ver = await this.obs.call('GetVersion')
        if (ver.obsVersion !== this.opts.expectedObsVersion) {
          throw new ObsVersionMismatchError(this.opts.expectedObsVersion, ver.obsVersion)
        }
      }
    } catch (error) {
      this.expectExit = true
      try { await this.obs?.disconnect() } catch { /* ignore */ }
      this.obs = undefined
      await this.opts.launcher.stopOwned()
      this.handle = undefined
      throw error
    }
  }

  async stop(): Promise<void> {
    this.expectExit = true
    try { await this.obs?.disconnect() } catch { /* ignore */ }
    this.obs = undefined
    await this.opts.launcher.stopOwned()
    this.handle = undefined
  }

  async restart(): Promise<void> {
    await this.stop()
    await sleep(2000)
    await this.start()
  }
}
