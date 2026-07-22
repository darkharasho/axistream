import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LinuxOwnedObsRuntime, type LinuxObsRuntimeManifest } from '../src/linux-owned-obs-runtime.js'

const bytes = Buffer.from('signed flatpak bundle')
const manifest: LinuxObsRuntimeManifest = {
  engineId: 'axistream-obs-linux-32.1.2',
  obsVersion: '32.1.2',
  appId: 'link.axi.AxiStream.OBS',
  bundleSha256: createHash('sha256').update(bytes).digest('hex'),
  expectedRef: 'app/link.axi.AxiStream.OBS/x86_64/stable',
  expectedCommit: '0123456789abcdef',
  expectedOrigin: 'axistream-obs',
}

describe('LinuxOwnedObsRuntime', () => {
  let dir: string
  let bundlePath: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'axi-flatpak-'))
    bundlePath = join(dir, 'axistream-obs.flatpak')
    writeFileSync(bundlePath, bytes)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function successfulExec() {
    return vi.fn(async (_command: string, args: string[]) => {
      if (args.includes('--show-ref')) return { code: 0, output: `${manifest.expectedRef}\n` }
      if (args.includes('--show-commit')) return { code: 0, output: `${manifest.expectedCommit}\n` }
      if (args.includes('--show-origin')) return { code: 0, output: `${manifest.expectedOrigin}\n` }
      return { code: 0, output: '' }
    })
  }

  it('verifies the bundle before running Flatpak', async () => {
    const exec = successfulExec()
    const runtime = new LinuxOwnedObsRuntime({
      manifest: { ...manifest, bundleSha256: '0'.repeat(64) }, bundlePath, exec,
      makeLauncher: vi.fn() as never,
    })

    await expect(runtime.prepare()).rejects.toThrow('failed integrity verification')
    expect(exec).not.toHaveBeenCalled()
  })

  it('installs an absent local bundle then verifies exact ref, commit, and origin', async () => {
    let installed = false
    const exec = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'install') { installed = true; return { code: 0, output: '' } }
      if (!installed) return { code: 1, output: 'not installed' }
      if (args.includes('--show-ref')) return { code: 0, output: manifest.expectedRef }
      if (args.includes('--show-commit')) return { code: 0, output: manifest.expectedCommit }
      if (args.includes('--show-origin')) return { code: 0, output: manifest.expectedOrigin }
      return { code: 0, output: '' }
    })
    const launcher = { launch: vi.fn(), stopOwned: vi.fn() }
    const makeLauncher = vi.fn(() => launcher as never)
    const configureWebsocket = vi.fn()
    const runtime = new LinuxOwnedObsRuntime({ manifest, bundlePath, exec, makeLauncher, configureWebsocket })

    const spec = await runtime.prepare()

    expect(exec.mock.calls[3]).toEqual(['flatpak', [
      'install', '--user', '--noninteractive', bundlePath,
    ]])
    expect(exec.mock.calls.slice(4, 7)).toEqual([
      ['flatpak', ['info', '--user', '--show-ref', manifest.appId]],
      ['flatpak', ['info', '--user', '--show-commit', manifest.appId]],
      ['flatpak', ['info', '--user', '--show-origin', manifest.appId]],
    ])
    // The owned OBS orphan is cleared before the launcher is handed back.
    expect(exec.mock.calls[7]).toEqual(['flatpak', ['kill', manifest.appId]])
    expect(makeLauncher).toHaveBeenCalledWith('link.axi.AxiStream.OBS')
    expect(configureWebsocket).toHaveBeenCalledOnce()
    expect(configureWebsocket.mock.calls[0][0]).toMatch(/\.var[/\\]app[/\\]link\.axi\.AxiStream\.OBS[/\\]config$/)
    expect(spec).toEqual({ launcher, expectedObsVersion: '32.1.2', engineId: manifest.engineId })
  })

  it('does not reinstall an already matching owned runtime', async () => {
    const exec = successfulExec()
    const configureWebsocket = vi.fn()
    const runtime = new LinuxOwnedObsRuntime({
      manifest, bundlePath, exec, makeLauncher: vi.fn(() => ({}) as never), configureWebsocket,
    })

    await runtime.prepare()

    // 3 identity probes + 1 owned-orphan kill; no install/reinstall.
    expect(exec.mock.calls).toHaveLength(4)
    expect(exec.mock.calls.some(([, args]) => args[0] === 'install')).toBe(false)
    expect(exec.mock.calls[3]).toEqual(['flatpak', ['kill', manifest.appId]])
    expect(configureWebsocket).toHaveBeenCalledOnce()
  })

  it('clears an owned OBS orphan but never targets a non-owned app id', async () => {
    const exec = successfulExec()
    const runtime = new LinuxOwnedObsRuntime({
      manifest, bundlePath, exec, makeLauncher: vi.fn(() => ({}) as never), configureWebsocket: vi.fn(),
    })

    await runtime.prepare()

    const killCalls = exec.mock.calls.filter(([, args]) => args[0] === 'kill')
    expect(killCalls).toEqual([['flatpak', ['kill', 'link.axi.AxiStream.OBS']]])
    // Belt and suspenders: no kill ever names the standard personal OBS id.
    expect(exec.mock.calls.some(([, args]) => args.includes('com.obsproject.Studio'))).toBe(false)
  })

  it.each([
    ['ref', '--show-ref', 'app/com.obsproject.Studio/x86_64/stable'],
    ['commit', '--show-commit', 'wrong-commit'],
    ['origin', '--show-origin', 'flathub'],
  ])('rejects a mismatched installed %s', async (_label, option, wrongOutput) => {
    const exec = successfulExec()
    exec.mockImplementation(async (_command: string, args: string[]) => {
      if (args.includes(option)) return { code: 0, output: wrongOutput }
      if (args.includes('--show-ref')) return { code: 0, output: manifest.expectedRef }
      if (args.includes('--show-commit')) return { code: 0, output: manifest.expectedCommit }
      if (args.includes('--show-origin')) return { code: 0, output: manifest.expectedOrigin }
      return { code: 0, output: '' }
    })

    await expect(new LinuxOwnedObsRuntime({ manifest, bundlePath, exec, makeLauncher: vi.fn() as never }).prepare())
      .rejects.toThrow('installed AxiStream OBS identity does not match')
    expect(exec.mock.calls.some(([, args]) => args.includes('--reinstall'))).toBe(true)
  })

  it('fails closed when bundle installation fails', async () => {
    const exec = vi.fn(async () => ({ code: 1, output: 'Flatpak runtime missing' }))
    const runtime = new LinuxOwnedObsRuntime({ manifest, bundlePath, exec, makeLauncher: vi.fn() as never })

    await expect(runtime.prepare()).rejects.toThrow('Could not install the dedicated AxiStream OBS runtime')
  })
})
