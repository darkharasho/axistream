import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { verifyRuntimeAssets } from '../../../scripts/obs-runtime-lib.mjs'

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
