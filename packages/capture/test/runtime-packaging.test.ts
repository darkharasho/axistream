import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { selectLinuxRuntimeSource, verifyRuntimeAssets } from '../../../scripts/obs-runtime-lib.mjs'

describe('verifyRuntimeAssets', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'axi-runtime-assets-')) })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('fails packaging when the selected platform payload is absent', async () => {
    const manifest = {
      windows: { archiveFile: 'obs.zip', archiveSha256: '0'.repeat(64) },
      linux: { bundleFile: 'obs.flatpak' },
    }
    await expect(verifyRuntimeAssets('win32', root, manifest as never)).rejects.toThrow('Missing owned Windows OBS runtime')
    await expect(verifyRuntimeAssets('linux', root, manifest as never)).rejects.toThrow('Missing owned Linux OBS runtime')
  })

  it('accepts only a hash-matching Windows archive', async () => {
    const bytes = Buffer.from('owned windows obs')
    const sha = createHash('sha256').update(bytes).digest('hex')
    mkdirSync(join(root, 'windows'), { recursive: true })
    writeFileSync(join(root, 'windows', 'obs.zip'), bytes)
    const manifest = { windows: { archiveFile: 'obs.zip', archiveSha256: sha }, linux: { bundleFile: 'obs.flatpak' } }

    await expect(verifyRuntimeAssets('win32', root, manifest as never)).resolves.toBeUndefined()
    writeFileSync(join(root, 'windows', 'obs.zip'), 'corrupt')
    await expect(verifyRuntimeAssets('win32', root, manifest as never)).rejects.toThrow('hash mismatch')
  })

  it('requires a Linux descriptor whose hash matches the dedicated bundle', async () => {
    const bytes = Buffer.from('owned linux obs')
    const sha = createHash('sha256').update(bytes).digest('hex')
    mkdirSync(join(root, 'linux'), { recursive: true })
    writeFileSync(join(root, 'linux', 'obs.flatpak'), bytes)
    writeFileSync(join(root, 'linux', 'runtime-manifest.json'), JSON.stringify({
      engineId: 'axistream-obs-linux-32.1.2', obsVersion: '32.1.2', appId: 'link.axi.AxiStream.OBS',
      bundleSha256: sha, expectedRef: 'app/link.axi.AxiStream.OBS/x86_64/stable',
      expectedCommit: 'commit', expectedOrigin: 'link.axi.AxiStream.OBS-origin',
    }))
    const manifest = { windows: { archiveFile: 'obs.zip', archiveSha256: '0'.repeat(64) }, linux: { bundleFile: 'obs.flatpak' } }

    await expect(verifyRuntimeAssets('linux', root, manifest as never)).resolves.toBeUndefined()
  })
})

describe('redistribution inputs', () => {
  it('archives the pinned recursive Linux source checkout without build products', () => {
    const root = resolve(import.meta.dirname, '../../..')
    const prepare = readFileSync(join(root, 'scripts/prepare-obs-runtime.mjs'), 'utf8')
    const flatpakManifest = readFileSync(join(root, 'packaging/flatpak/link.axi.AxiStream.OBS.json'), 'utf8')
    expect(prepare).toContain('obs-studio-32.1.2-axistream-corresponding-source.tar.xz')
    expect(prepare).toContain("'clone', '--recursive'")
    expect(prepare).toContain("'rev-parse', 'HEAD'")
    expect(prepare).toContain('--exclude=_flatpak_build')
    expect(flatpakManifest).toContain('fb4d98bf88fae5fc85cb11fc57f7c5e309282194')
  })
})

describe('selectLinuxRuntimeSource', () => {
  const pinned = {
    obsVersion: '32.1.2',
    prebuilt: { obsVersion: '32.1.2', bundleUrl: 'https://example/obs.flatpak' },
  }

  it('downloads the prebuilt bundle when the manifest pins one', () => {
    expect(selectLinuxRuntimeSource(pinned as never)).toBe('prebuilt')
  })

  it('builds from source when no bundle is pinned yet', () => {
    expect(selectLinuxRuntimeSource({ obsVersion: '32.1.2' } as never)).toBe('source')
  })

  it('builds from source when explicitly asked — this is how the bundle gets made', () => {
    expect(selectLinuxRuntimeSource(pinned as never, { fromSource: true })).toBe('source')
  })

  it('refuses a prebuilt bundle left behind by an OBS version bump', () => {
    const bumped = { ...pinned, obsVersion: '32.2.0' }
    expect(() => selectLinuxRuntimeSource(bumped as never)).toThrow('pinned to 32.1.2 but the manifest wants 32.2.0')
  })
})

describe('prebuilt Linux runtime pin', () => {
  it('pins a bundle whose URL, source archive and version all agree with the manifest', () => {
    const root = resolve(import.meta.dirname, '../../..')
    const manifest = JSON.parse(readFileSync(join(root, 'resources/obs-runtime/manifest.json'), 'utf8'))
    const { prebuilt, obsVersion } = manifest.linux
    expect(prebuilt, 'manifest.linux.prebuilt is what keeps OBS off the release critical path').toBeTruthy()
    expect(prebuilt.obsVersion).toBe(obsVersion)
    for (const field of ['bundleUrl', 'descriptorUrl', 'correspondingSourceUrl']) {
      expect(prebuilt[field]).toMatch(new RegExp(`^https://github.com/darkharasho/axistream/releases/download/obs-runtime-${obsVersion}/`))
    }
    for (const field of ['bundleSha256', 'descriptorSha256', 'correspondingSourceSha256']) {
      expect(prebuilt[field], field).toMatch(/^[a-f0-9]{64}$/)
    }
  })
})
