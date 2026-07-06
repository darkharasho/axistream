import { describe, it, expect, vi } from 'vitest'
import { PluginInstaller, deriveGameAudioStatus, PLUGIN_REF } from '../src/main/PluginInstaller.js'

function fakeExec(script: (cmd: string, args: string[]) => { code: number; output: string } | Error) {
  const calls: { cmd: string; args: string[]; timeoutMs: number }[] = []
  const exec = vi.fn(async (cmd: string, args: string[], timeoutMs: number) => {
    calls.push({ cmd, args, timeoutMs })
    const r = script(cmd, args)
    if (r instanceof Error) throw r
    return r
  })
  return { exec, calls }
}

describe('PluginInstaller.detectInstalled', () => {
  it('exit 0 → installed', async () => {
    const f = fakeExec(() => ({ code: 0, output: 'Ref: ...' }))
    expect(await new PluginInstaller(f).detectInstalled()).toBe('installed')
    expect(f.calls[0]).toEqual({ cmd: 'flatpak', args: ['info', PLUGIN_REF], timeoutMs: 15000 })
  })
  it('nonzero exit → missing', async () => {
    const f = fakeExec(() => ({ code: 1, output: 'error: not installed' }))
    expect(await new PluginInstaller(f).detectInstalled()).toBe('missing')
  })
  it('spawn failure (no flatpak) → unsupported', async () => {
    const f = fakeExec(() => new Error('ENOENT'))
    expect(await new PluginInstaller(f).detectInstalled()).toBe('unsupported')
  })
})

describe('PluginInstaller.install', () => {
  it('user-level success issues the exact argv', async () => {
    const f = fakeExec(() => ({ code: 0, output: 'ok' }))
    expect(await new PluginInstaller(f).install()).toEqual({ ok: true })
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]).toEqual({ cmd: 'flatpak', args: ['install', '--user', '--noninteractive', 'flathub', PLUGIN_REF], timeoutMs: 600000 })
  })
  it('user failure retries system-level once', async () => {
    const f = fakeExec((_c, args) => args.includes('--user') ? { code: 1, output: 'denied' } : { code: 0, output: 'ok' })
    expect(await new PluginInstaller(f).install()).toEqual({ ok: true })
    expect(f.calls).toHaveLength(2)
    expect(f.calls[1].args).toEqual(['install', '--system', '--noninteractive', 'flathub', PLUGIN_REF])
  })
  it('both fail → ok:false with output tail', async () => {
    const f = fakeExec(() => ({ code: 1, output: 'x'.repeat(600) + 'TAIL' }))
    const r = await new PluginInstaller(f).install()
    expect(r.ok).toBe(false)
    expect(r.error).toHaveLength(500)
    expect(r.error!.endsWith('TAIL')).toBe(true)
  })
  it('spawn throw → ok:false, never rejects', async () => {
    const f = fakeExec(() => new Error('ENOENT'))
    await expect(new PluginInstaller(f).install()).resolves.toMatchObject({ ok: false })
  })
})

describe('deriveGameAudioStatus', () => {
  const K = ['monitor_capture', 'pipewire-screen-capture-source', 'pulse_input_capture']
  it('unsupported flatpak → unsupported', () => { expect(deriveGameAudioStatus('unsupported', K)).toBe('unsupported') })
  it('missing → missing', () => { expect(deriveGameAudioStatus('missing', K)).toBe('missing') })
  it('installed but no audio kind → installed', () => { expect(deriveGameAudioStatus('installed', K)).toBe('installed') })
  it('installed + pipewire audio kind → ready', () => {
    expect(deriveGameAudioStatus('installed', [...K, 'pipewire-audio-application-capture'])).toBe('ready')
  })
  it('screen-capture kind alone never counts as ready', () => {
    expect(deriveGameAudioStatus('installed', ['pipewire-screen-capture-source'])).toBe('installed')
  })
})
