import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

export interface ObsLaunchHandle {
  kill(): void
  onExit(cb: (code: number | null) => void): void
}

export interface ObsLauncher {
  launch(args: string[]): ObsLaunchHandle
  killApp(): void | Promise<void>
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

const APP_ID = 'com.obsproject.Studio'

// Dev launcher: the developer's Flatpak OBS. The bundled portable OBS will be a
// separate launcher behind this same interface.
export class FlatpakObsLauncher implements ObsLauncher {
  launch(args: string[]): ObsLaunchHandle {
    const proc = spawn('flatpak', ['run', APP_ID, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    proc.stdout.on('data', (d) => process.stdout.write(`[obs] ${d}`))
    proc.stderr.on('data', (d) => process.stderr.write(`[obs] ${d}`))
    return {
      kill: () => { try { proc.kill() } catch { /* ignore */ } },
      onExit: (cb) => proc.on('exit', cb),
    }
  }
  // Flatpak reparents the app out of the `flatpak run` child; kill the app itself.
  killApp(): void {
    try { spawn('flatpak', ['kill', APP_ID], { stdio: 'ignore' }) } catch { /* ignore */ }
  }
}
