import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('owned OBS runtime manifest', () => {
  it('pins immutable Windows and Linux OBS 32.1.2 inputs', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'resources/obs-runtime/manifest.json'), 'utf8'))
    expect(manifest.schema).toBe(1)
    expect(manifest.windows).toEqual(expect.objectContaining({
      engineId: 'axistream-obs-windows-32.1.2', obsVersion: '32.1.2',
      archiveSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(manifest.linux).toEqual(expect.objectContaining({
      engineId: 'axistream-obs-linux-32.1.2', obsVersion: '32.1.2', appId: 'link.axi.AxiStream.OBS',
      expectedOrigin: 'obs-origin',
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(JSON.stringify(manifest)).not.toMatch(/\/latest\b|releases\/latest/i)
    const flatpak = readFileSync(join(root, 'packaging/flatpak/link.axi.AxiStream.OBS.json'), 'utf8')
    expect(flatpak).toContain('78935e15be876ea667df946c91145a6a6c2b4254')
    expect(flatpak).toContain('adaeef80f8216e0852e2dace66abb51606ad6373')

    // The pinned archive hash lives only in the manifest — app main must read it,
    // never hardcode a second copy that could silently drift on a version bump.
    const appMain = readFileSync(join(root, 'packages/app/src/main/index.ts'), 'utf8')
    expect(appMain).not.toContain(manifest.windows.archiveSha256)
  })
})

describe('static personal-OBS isolation gate', () => {
  it('contains no production path that probes, launches, configures, or broadly kills personal OBS', () => {
    const productionFiles = [
      ...filesBelow(join(root, 'packages/capture/src')),
      ...filesBelow(join(root, 'packages/app/src/main')),
    ]
    const source = productionFiles.map((path) => `${path}\n${readFileSync(path, 'utf8')}`).join('\n')
    expect(source).not.toContain('com.obsproject.Studio')
    expect(source).not.toMatch(/ProgramFiles|taskkill|\/IM['"],?\s*['"]obs64\.exe/i)
    expect(source).not.toMatch(/process\.env\[['"]APPDATA['"]\]/)
  })

  it('wires both platform-owned runtime implementations into app main', () => {
    const main = readFileSync(join(root, 'packages/app/src/main/index.ts'), 'utf8')
    expect(main).toContain('new WindowsOwnedObsRuntime')
    expect(main).toContain('new LinuxOwnedObsRuntime')
    expect(main).toContain("process.argv.includes('--smoke-runtime')")
    expect(main).toContain('SMOKE OK owned runtime')
    expect(main).not.toContain('The dedicated AxiStream OBS Flatpak runtime is not packaged in this build')
  })

  it('makes CI and release builds prepare owned assets without installing personal OBS', () => {
    const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
    const release = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')
    expect(ci).not.toMatch(/choco install obs-studio|flatpak (?:install|run).*com\.obsproject\.Studio/)
    expect(ci).toContain('npm run prepare:obs-runtime -- --platform=windows')
    expect(ci).toContain('npm run prepare:obs-runtime -- --platform=linux')
    expect(ci).toContain('--smoke-runtime')
    expect(release).toContain('npm run prepare:obs-runtime -- --platform=windows')
    expect(release).toContain('npm run prepare:obs-runtime -- --platform=linux')
  })
})
