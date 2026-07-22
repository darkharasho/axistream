import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { FlatpakObsLauncher, OWNED_OBS_APP_ID, type ObsLauncher } from './obs-launcher.js'
import { HeadlessCageObsLauncher } from './headless-cage-launcher.js'
import type { OwnedObsLaunchSpec, OwnedObsRuntime } from './owned-obs-runtime.js'
import { enableOwnedObsWebsocketServer } from './windows-obs-launcher.js'

export interface LinuxObsRuntimeManifest {
  engineId: string
  obsVersion: string
  appId: string
  bundleSha256: string
  expectedRef: string
  expectedCommit: string
  expectedOrigin: string
}

export type FlatpakExec = (command: string, args: string[]) => Promise<{ code: number; output: string }>

export interface LinuxOwnedObsRuntimeOptions {
  manifest: LinuxObsRuntimeManifest
  bundlePath: string
  headless?: boolean
  exec?: FlatpakExec
  makeLauncher?: (appId: string) => ObsLauncher
  configureWebsocket?: (configRoot: string) => void
}

interface InstalledIdentity {
  ref: string
  commit: string
  origin: string
}

const defaultExec: FlatpakExec = (command, args) => new Promise((resolve, reject) => {
  execFile(command, args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') { reject(error); return }
    resolve({ code: error ? 1 : 0, output: `${stdout ?? ''}${stderr ?? ''}` })
  })
})

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

export class LinuxOwnedObsRuntime implements OwnedObsRuntime {
  readonly engineId: string
  readonly configIdentity: string
  private readonly exec: FlatpakExec
  private readonly makeLauncher: (appId: string) => ObsLauncher
  private readonly configureWebsocket: (configRoot: string) => void

  constructor(private readonly options: LinuxOwnedObsRuntimeOptions) {
    if (options.manifest.appId !== OWNED_OBS_APP_ID) {
      throw new Error(`Refusing non-owned OBS Flatpak identity: ${options.manifest.appId}`)
    }
    this.engineId = options.manifest.engineId
    this.configIdentity = `flatpak:${options.manifest.appId}`
    this.exec = options.exec ?? defaultExec
    this.makeLauncher = options.makeLauncher ?? ((appId) => {
      const visible = new FlatpakObsLauncher(appId)
      return options.headless ? new HeadlessCageObsLauncher(visible, appId) : visible
    })
    this.configureWebsocket = options.configureWebsocket ?? ((configRoot) =>
      enableOwnedObsWebsocketServer(configRoot, undefined, join))
  }

  async prepare(): Promise<OwnedObsLaunchSpec> {
    const { manifest, bundlePath } = this.options
    if (!existsSync(bundlePath) || await hashFile(bundlePath) !== manifest.bundleSha256) {
      throw new Error('The packaged AxiStream OBS Flatpak bundle failed integrity verification')
    }
    let identity = await this.installedIdentity()
    if (!identity || !this.identityMatches(identity)) {
      let install: Awaited<ReturnType<FlatpakExec>>
      try {
        install = await this.exec('flatpak', [
          'install', '--user', '--noninteractive', ...(identity ? ['--reinstall'] : []), bundlePath,
        ])
      } catch (error) {
        throw new Error(`Could not install the dedicated AxiStream OBS runtime: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (install.code !== 0) {
        throw new Error(`Could not install the dedicated AxiStream OBS runtime: ${install.output.trim() || 'Flatpak returned an error'}`)
      }
      identity = await this.installedIdentity()
    }
    if (!identity || !this.identityMatches(identity)) {
      throw new Error('The installed AxiStream OBS identity does not match the verified packaged runtime')
    }
    // A prior AxiStream session that died hard (SIGKILL/OOM/power loss) can leave
    // its owned OBS running; with --multi the next launch would spawn a second
    // instance and leak the first. Clear only the dedicated app id — never personal
    // OBS — before handing back a launcher. Best-effort: a no-op when none is running.
    await this.exec('flatpak', ['kill', manifest.appId]).catch(() => { /* nothing to clean */ })
    this.configureWebsocket(join(homedir(), '.var', 'app', manifest.appId, 'config'))
    return {
      launcher: this.makeLauncher(manifest.appId),
      expectedObsVersion: manifest.obsVersion,
      engineId: manifest.engineId,
    }
  }

  private async installedIdentity(): Promise<InstalledIdentity | null> {
    const options = ['--show-ref', '--show-commit', '--show-origin'] as const
    const results = await Promise.all(options.map((option) =>
      this.exec('flatpak', ['info', '--user', option, this.options.manifest.appId]),
    ))
    if (results.some((result) => result.code !== 0)) return null
    return { ref: results[0].output.trim(), commit: results[1].output.trim(), origin: results[2].output.trim() }
  }

  private identityMatches(identity: InstalledIdentity): boolean {
    const { manifest } = this.options
    return identity.ref === manifest.expectedRef &&
      identity.commit === manifest.expectedCommit &&
      identity.origin === manifest.expectedOrigin
  }
}
