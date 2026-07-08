import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { ObsLauncher, ObsLaunchHandle } from './obs-launcher.js'

export interface WebsocketConfigDeps {
  mkdir(path: string): void
  read(path: string): string | null
  write(path: string, content: string): void
}

const realConfigDeps: WebsocketConfigDeps = {
  mkdir: (p) => mkdirSync(p, { recursive: true }),
  read: (p) => { try { return readFileSync(p, 'utf8') } catch { return null } },
  write: (p, c) => writeFileSync(p, c),
}

/** Windows OBS ships obs-websocket with `server_enabled: false` and the
 *  --websocket_port/--websocket_password CLI flags only OVERRIDE port and
 *  password — they never enable the server (confirmed on OBS 32.1.2: plain
 *  launch with the flags leaves the port closed; pre-writing server_enabled
 *  makes it listen). Merge-write the plugin config before launch so the
 *  sidecar's port-wait can succeed. Best-effort: any failure leaves OBS to
 *  launch anyway and the sidecar's timeout reports it. */
export function enableObsWebsocketServer(
  appData: string | undefined = process.env['APPDATA'],
  deps: WebsocketConfigDeps = realConfigDeps,
): void {
  if (!appData) return
  try {
    const dir = `${appData}\\obs-studio\\plugin_config\\obs-websocket`
    const file = `${dir}\\config.json`
    deps.mkdir(dir)
    let cfg: Record<string, unknown> = {}
    const existing = deps.read(file)
    if (existing) {
      try { cfg = JSON.parse(existing) as Record<string, unknown> } catch { cfg = {} }
    }
    if (cfg['server_enabled'] === true) return
    cfg['server_enabled'] = true
    deps.write(file, JSON.stringify(cfg, null, 2))
  } catch (e) {
    console.warn('[obs] enabling websocket server config failed:', e instanceof Error ? e.message : e)
  }
}

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
    enableObsWebsocketServer()
    const cwd = exe.slice(0, exe.lastIndexOf('\\'))
    const proc = spawn(exe, ['--minimize-to-tray', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    proc.on('error', (e) => console.error('[obs] spawn failed:', e.message))
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
