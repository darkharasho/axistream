import { spawn as nodeSpawn } from 'node:child_process'
import { createServer } from 'node:net'

export interface ObsLaunchHandle {
  kill(): void
  onExit(cb: (code: number | null) => void): void
}

export interface ObsLauncher {
  launch(args: string[]): ObsLaunchHandle
  stopOwned(): void | Promise<void>
}

export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const p = addr.port
        srv.close(() => resolve(p))
      } else {
        srv.close(() => reject(new Error('could not get a free port')))
      }
    })
  })
}

export const OWNED_OBS_APP_ID = 'link.axi.AxiStream.OBS'

// Launches only the dedicated Flatpak identity installed from AxiStream's
// verified bundle. Constructor validation prevents accidental personal-OBS use.
export class FlatpakObsLauncher implements ObsLauncher {
  constructor(
    private readonly appId = OWNED_OBS_APP_ID,
    private readonly spawnProcess: typeof nodeSpawn = nodeSpawn,
    private readonly killTimeoutMs = 5000,
  ) {
    if (appId !== OWNED_OBS_APP_ID) throw new Error(`Refusing non-owned OBS Flatpak identity: ${appId}`)
  }

  launch(args: string[]): ObsLaunchHandle {
    const proc = this.spawnProcess('flatpak', ['run', this.appId, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    proc.stdout?.on('data', (d) => console.log(`[obs] ${String(d).trimEnd()}`))
    proc.stderr?.on('data', (d) => console.warn(`[obs] ${String(d).trimEnd()}`))
    return {
      kill: () => { try { proc.kill() } catch { /* ignore */ } },
      onExit: (cb) => proc.on('exit', cb),
    }
  }
  // Flatpak reparents the app out of the `flatpak run` child; kill the app
  // itself. Awaited so teardown can sequence behind it — a fire-and-forget
  // spawn lets the app exit while OBS is still winding down. Best-effort: a
  // wedged or missing `flatpak` resolves rather than holding quit open.
  async stopOwned(): Promise<void> {
    let proc: ReturnType<typeof nodeSpawn>
    try {
      proc = this.spawnProcess('flatpak', ['kill', this.appId], { stdio: 'ignore' })
    } catch { return }
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); resolve() }
      const timer = setTimeout(done, this.killTimeoutMs)
      timer.unref?.()
      proc.once('exit', done)
      proc.once('error', done)
    })
  }
}
