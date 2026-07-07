import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ObsLauncher, ObsLaunchHandle } from './obs-launcher.js'

const APP_ID = 'com.obsproject.Studio'
const HEADLESS_ENV = {
  WLR_BACKENDS: 'headless',
  WLR_HEADLESS_OUTPUTS: '1',
  WLR_LIBINPUT_NO_DEVICES: '1',
}

// True if a `cage` executable is on PATH.
export function cageOnPath(): boolean {
  const dirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean)
  return dirs.some((d) => {
    try { return existsSync(join(d, 'cage')) } catch { return false }
  })
}

export interface HeadlessCageOptions {
  isCageAvailable?: () => boolean
  spawnProcess?: (cmd: string, args: string[], env: NodeJS.ProcessEnv) => ObsLaunchHandle
}

function defaultSpawn(cmd: string, args: string[], env: NodeJS.ProcessEnv): ObsLaunchHandle {
  const proc = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stdout.on('data', (d) => process.stdout.write(`[obs] ${d}`))
  proc.stderr.on('data', (d) => process.stderr.write(`[obs] ${d}`))
  return {
    kill: () => { try { proc.kill() } catch { /* ignore */ } },
    onExit: (cb) => proc.on('exit', cb),
  }
}

// Launches OBS invisibly inside a headless wlroots compositor (cage), so it
// renders (capture + streaming + idle preview all keep working) without ever
// showing a window. Falls back to the wrapped (visible) launcher when cage is
// not available. killApp delegates to the fallback — `flatpak kill` ends OBS
// regardless of how it was launched; ObsSidecar.stop() additionally kills the
// spawned cage child via the returned handle.
export class HeadlessCageObsLauncher implements ObsLauncher {
  constructor(
    private readonly fallback: ObsLauncher,
    private readonly opts: HeadlessCageOptions = {},
  ) {}

  launch(args: string[]): ObsLaunchHandle {
    const available = (this.opts.isCageAvailable ?? cageOnPath)()
    if (!available) return this.fallback.launch(args)
    const env = { ...process.env, ...HEADLESS_ENV }
    const cageArgs = ['--', 'flatpak', 'run', APP_ID, ...args]
    return (this.opts.spawnProcess ?? defaultSpawn)('cage', cageArgs, env)
  }

  killApp(): void {
    this.fallback.killApp()
  }
}
