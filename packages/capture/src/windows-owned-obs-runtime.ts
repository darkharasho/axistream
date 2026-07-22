import { createHash } from 'node:crypto'
import {
  cpSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync,
  renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import extractZip from 'extract-zip'
import type { OwnedObsLaunchSpec, OwnedObsRuntime } from './owned-obs-runtime.js'
import { WindowsObsLauncher, type WindowsObsLauncherOptions } from './windows-obs-launcher.js'

const MARKER = '.axistream-owned-obs.json'

export interface WindowsObsRuntimeManifest {
  engineId: string
  obsVersion: string
  archiveSha256: string
  executableRelativePath: string
}

interface OwnershipMarker extends WindowsObsRuntimeManifest {
  engineTreeSha256: string
}

export type ArchiveExtractor = (archivePath: string, destination: string) => Promise<void>

export interface WindowsOwnedObsRuntimeOptions {
  manifest: WindowsObsRuntimeManifest
  archivePath: string
  installRoot: string
  extractArchive?: ArchiveExtractor
  makeLauncher?: (options: Pick<WindowsObsLauncherOptions, 'executablePath' | 'configRoot'>) => WindowsObsLauncher
}

export function assertSafeArchiveEntry(fileName: string, externalFileAttributes: number): void {
  const normalized = fileName.replace(/\\/g, '/')
  const segments = normalized.split('/')
  if (
    !normalized || normalized.startsWith('/') || normalized.startsWith('\\') ||
    /^[A-Za-z]:/.test(normalized) || segments.includes('..')
  ) throw new Error(`unsafe OBS archive entry: ${fileName}`)
  const mode = (externalFileAttributes >>> 16) & 0xffff
  if ((mode & 0o170000) === 0o120000) throw new Error(`symbolic link in OBS archive: ${fileName}`)
}

const defaultExtract: ArchiveExtractor = async (archivePath, destination) => {
  const resolvedDestination = resolve(destination)
  await extractZip(archivePath, {
    dir: resolvedDestination,
    onEntry: (entry) => assertSafeArchiveEntry(entry.fileName, entry.externalFileAttributes),
  })
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolvePromise)
  })
  return hash.digest('hex')
}

function engineFiles(root: string, current = root): string[] {
  const result: string[] = []
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name)
    const rel = relative(root, path)
    if (rel === 'config' || rel.startsWith(`config${sep}`) || rel === MARKER) continue
    if (entry.isSymbolicLink()) throw new Error(`owned OBS runtime contains a symbolic link: ${rel}`)
    if (entry.isDirectory()) result.push(...engineFiles(root, path))
    else if (entry.isFile()) result.push(rel)
    else throw new Error(`owned OBS runtime contains an unsupported entry: ${rel}`)
  }
  return result.sort()
}

async function hashEngineTree(root: string): Promise<string> {
  const hash = createHash('sha256')
  for (const rel of engineFiles(root)) {
    hash.update(rel.replaceAll(sep, '/'))
    hash.update('\0')
    hash.update(await hashFile(join(root, rel)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function readMarker(target: string): OwnershipMarker | null {
  try { return JSON.parse(readFileSync(join(target, MARKER), 'utf8')) as OwnershipMarker } catch { return null }
}

function markerMatchesManifest(marker: OwnershipMarker | null, manifest: WindowsObsRuntimeManifest): marker is OwnershipMarker {
  return Boolean(marker &&
    marker.engineId === manifest.engineId &&
    marker.obsVersion === manifest.obsVersion &&
    marker.archiveSha256 === manifest.archiveSha256 &&
    marker.executableRelativePath === manifest.executableRelativePath &&
    /^[a-f0-9]{64}$/.test(marker.engineTreeSha256))
}

function assertPathInside(root: string, child: string): void {
  const rel = relative(resolve(root), resolve(child))
  if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) {
    throw new Error('Owned OBS entry point must be a relative path inside the runtime')
  }
}

export class WindowsOwnedObsRuntime implements OwnedObsRuntime {
  readonly engineId: string
  readonly configIdentity: string
  private readonly extractArchive: ArchiveExtractor
  private readonly makeLauncher: NonNullable<WindowsOwnedObsRuntimeOptions['makeLauncher']>

  constructor(private readonly options: WindowsOwnedObsRuntimeOptions) {
    this.engineId = options.manifest.engineId
    this.configIdentity = `portable:${options.manifest.engineId}`
    this.extractArchive = options.extractArchive ?? defaultExtract
    this.makeLauncher = options.makeLauncher ?? ((launcherOptions) => new WindowsObsLauncher(launcherOptions))
  }

  async prepare(): Promise<OwnedObsLaunchSpec> {
    const { manifest, archivePath, installRoot } = this.options
    if (!existsSync(archivePath) || await hashFile(archivePath) !== manifest.archiveSha256) {
      throw new Error('The packaged AxiStream OBS runtime failed integrity verification')
    }
    const target = join(installRoot, manifest.obsVersion)
    const staging = `${target}.staging`
    const backup = `${target}.repair-backup`
    const executablePath = join(target, manifest.executableRelativePath)
    assertPathInside(target, executablePath)
    mkdirSync(installRoot, { recursive: true })
    rmSync(staging, { recursive: true, force: true })
    rmSync(backup, { recursive: true, force: true })

    let repair = false
    if (existsSync(target)) {
      const marker = readMarker(target)
      if (!markerMatchesManifest(marker, manifest)) {
        throw new Error('AxiStream OBS runtime ownership could not be proven; refusing to replace or launch it')
      }
      if (existsSync(executablePath) && statSync(executablePath).isFile() && await hashEngineTree(target) === marker.engineTreeSha256) {
        return this.launchSpec(target)
      }
      repair = true
    }

    await this.extractToStaging(staging)
    if (repair && existsSync(join(target, 'config'))) {
      cpSync(join(target, 'config'), join(staging, 'config'), { recursive: true, force: true })
    }
    if (repair) renameSync(target, backup)
    try {
      renameSync(staging, target)
    } catch (error) {
      if (repair && existsSync(backup) && !existsSync(target)) renameSync(backup, target)
      throw error
    }
    if (repair) rmSync(backup, { recursive: true, force: true })
    return this.launchSpec(target)
  }

  private async extractToStaging(staging: string): Promise<void> {
    const { manifest, archivePath } = this.options
    mkdirSync(staging, { recursive: true })
    try {
      await this.extractArchive(archivePath, staging)
      const executable = join(staging, manifest.executableRelativePath)
      assertPathInside(staging, executable)
      if (!existsSync(executable) || !statSync(executable).isFile()) {
        throw new Error(`Packaged AxiStream OBS is missing ${manifest.executableRelativePath}`)
      }
      mkdirSync(join(staging, 'config'), { recursive: true })
      const marker: OwnershipMarker = { ...manifest, engineTreeSha256: await hashEngineTree(staging) }
      writeFileSync(join(staging, MARKER), JSON.stringify(marker, null, 2))
    } catch (error) {
      rmSync(staging, { recursive: true, force: true })
      throw new Error(`Could not prepare the AxiStream OBS runtime: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private launchSpec(target: string): OwnedObsLaunchSpec {
    const { manifest } = this.options
    const launcher = this.makeLauncher({
      executablePath: join(target, manifest.executableRelativePath),
      configRoot: join(target, 'config'),
    })
    return { launcher, expectedObsVersion: manifest.obsVersion, engineId: manifest.engineId }
  }
}
