import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  WindowsOwnedObsRuntime,
  assertSafeArchiveEntry,
  type WindowsObsRuntimeManifest,
} from '../src/windows-owned-obs-runtime.js'

const archiveBytes = Buffer.from('pinned-obs-archive')
const archiveSha256 = createHash('sha256').update(archiveBytes).digest('hex')
const manifest: WindowsObsRuntimeManifest = {
  engineId: 'axistream-obs-windows-32.1.2',
  obsVersion: '32.1.2',
  archiveSha256,
  executableRelativePath: 'bin/64bit/obs64.exe',
}

describe('assertSafeArchiveEntry', () => {
  it.each(['../escape', 'dir/../../escape', '/absolute', '\\absolute', 'C:\\escape'])('rejects unsafe path %s', (path) => {
    expect(() => assertSafeArchiveEntry(path, 0)).toThrow('unsafe OBS archive entry')
  })

  it('rejects symbolic links', () => {
    expect(() => assertSafeArchiveEntry('safe/link', 0o120777 << 16)).toThrow('symbolic link')
  })

  it('accepts a normal relative file', () => {
    expect(() => assertSafeArchiveEntry('bin/64bit/obs64.exe', 0o100644 << 16)).not.toThrow()
  })
})

describe('WindowsOwnedObsRuntime', () => {
  let dir: string
  let archivePath: string
  let installRoot: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'axi-owned-obs-'))
    archivePath = join(dir, 'obs.zip')
    installRoot = join(dir, 'runtime')
    writeFileSync(archivePath, archiveBytes)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function extractor() {
    return vi.fn(async (_archive: string, destination: string) => {
      mkdirSync(join(destination, 'bin', '64bit'), { recursive: true })
      writeFileSync(join(destination, 'bin', '64bit', 'obs64.exe'), 'owned executable')
      mkdirSync(join(destination, 'data'), { recursive: true })
      writeFileSync(join(destination, 'data', 'module.dll'), 'owned module')
    })
  }

  it('rejects a packaged archive whose hash does not match the manifest', async () => {
    const extractArchive = extractor()
    const runtime = new WindowsOwnedObsRuntime({
      manifest: { ...manifest, archiveSha256: '0'.repeat(64) }, archivePath, installRoot, extractArchive,
      makeLauncher: vi.fn() as never,
    })

    await expect(runtime.prepare()).rejects.toThrow('failed integrity verification')
    expect(extractArchive).not.toHaveBeenCalled()
  })

  it('extracts through staging, writes an ownership marker, and returns the explicit launch spec', async () => {
    const extractArchive = extractor()
    const launcher = { launch: vi.fn(), stopOwned: vi.fn() }
    const makeLauncher = vi.fn(() => launcher as never)
    const runtime = new WindowsOwnedObsRuntime({ manifest, archivePath, installRoot, extractArchive, makeLauncher })

    const spec = await runtime.prepare()

    const target = join(installRoot, manifest.obsVersion)
    expect(spec).toEqual({ launcher, expectedObsVersion: '32.1.2', engineId: manifest.engineId })
    expect(makeLauncher).toHaveBeenCalledWith({
      executablePath: join(target, 'bin/64bit/obs64.exe'),
      configRoot: join(target, 'config'),
    })
    const marker = JSON.parse(readFileSync(join(target, '.axistream-owned-obs.json'), 'utf8'))
    expect(marker).toEqual(expect.objectContaining({
      engineId: manifest.engineId,
      archiveSha256,
      executableRelativePath: manifest.executableRelativePath,
      engineTreeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(existsSync(`${target}.staging`)).toBe(false)
  })

  it('reuses an intact owned runtime without extracting again', async () => {
    const firstExtract = extractor()
    const opts = { manifest, archivePath, installRoot, extractArchive: firstExtract, makeLauncher: vi.fn(() => ({}) as never) }
    await new WindowsOwnedObsRuntime(opts).prepare()
    const secondExtract = extractor()

    await new WindowsOwnedObsRuntime({ ...opts, extractArchive: secondExtract }).prepare()

    expect(secondExtract).not.toHaveBeenCalled()
  })

  it('repairs changed engine files while preserving owned config', async () => {
    const opts = { manifest, archivePath, installRoot, extractArchive: extractor(), makeLauncher: vi.fn(() => ({}) as never) }
    await new WindowsOwnedObsRuntime(opts).prepare()
    const target = join(installRoot, manifest.obsVersion)
    mkdirSync(join(target, 'config'), { recursive: true })
    writeFileSync(join(target, 'config', 'service.json'), 'private AxiStream config')
    writeFileSync(join(target, 'data', 'module.dll'), 'tampered')
    const repairExtract = extractor()

    await new WindowsOwnedObsRuntime({ ...opts, extractArchive: repairExtract }).prepare()

    expect(repairExtract).toHaveBeenCalledOnce()
    expect(readFileSync(join(target, 'config', 'service.json'), 'utf8')).toBe('private AxiStream config')
    expect(readFileSync(join(target, 'data', 'module.dll'), 'utf8')).toBe('owned module')
  })

  it('cleans an interrupted staging directory before extracting', async () => {
    const stale = join(installRoot, `${manifest.obsVersion}.staging`)
    mkdirSync(stale, { recursive: true })
    writeFileSync(join(stale, 'partial'), 'partial')
    const extractArchive = extractor()

    await new WindowsOwnedObsRuntime({
      manifest, archivePath, installRoot, extractArchive, makeLauncher: vi.fn(() => ({}) as never),
    }).prepare()

    expect(existsSync(join(stale, 'partial'))).toBe(false)
    expect(extractArchive).toHaveBeenCalledOnce()
  })
})
