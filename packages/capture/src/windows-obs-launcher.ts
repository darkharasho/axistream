import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { ObsLauncher, ObsLaunchHandle } from './obs-launcher.js'

/** Locate an installed OBS Studio on Windows. Pure given env + exists —
 *  probes the standard 64-bit install, the x86 tree, and per-user installs. */
export function resolveWindowsObsExe(
  env: Record<string, string | undefined> = process.env,
  exists: (p: string) => boolean = existsSync,
): string | null {
  const suffix = '\\obs-studio\\bin\\64bit\\obs64.exe'
  const roots = [
    env['ProgramFiles'],
    env['ProgramFiles(x86)'],
    env['LOCALAPPDATA'] ? `${env['LOCALAPPDATA']}\\Programs` : undefined,
  ]
  for (const root of roots) {
    if (!root) continue
    const p = `${root}${suffix}`
    if (exists(p)) return p
  }
  return null
}

// UNTESTED ON WINDOWS: the spawn/kill runtime paths mirror FlatpakObsLauncher
// but have not run on a real Windows machine yet — treat the first Windows
// boot as a smoke test. OBS on Windows must be started from its own bin dir
// (cwd) or it fails to find its modules.
export class WindowsObsLauncher implements ObsLauncher {
  launch(args: string[]): ObsLaunchHandle {
    const exe = resolveWindowsObsExe()
    if (!exe) throw new Error('OBS Studio not found — install it from obsproject.com, then relaunch AxiStream')
    const cwd = exe.slice(0, exe.lastIndexOf('\\'))
    const proc = spawn(exe, ['--minimize-to-tray', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    proc.stdout.on('data', (d) => process.stdout.write(`[obs] ${d}`))
    proc.stderr.on('data', (d) => process.stderr.write(`[obs] ${d}`))
    return {
      kill: () => { try { proc.kill() } catch { /* ignore */ } },
      onExit: (cb) => proc.on('exit', cb),
    }
  }
  killApp(): void {
    try { spawn('taskkill', ['/F', '/IM', 'obs64.exe'], { stdio: 'ignore' }) } catch { /* ignore */ }
  }
}
