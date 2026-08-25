import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { FlatpakObsLauncher } from '../src/obs-launcher.js'

const fakeChild = () => {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = () => {}
  return proc
}

describe('OBS launcher output', () => {
  it('routes flatpak stdout through console so the log sink captures it', () => {
    const proc = fakeChild()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const launcher = new FlatpakObsLauncher(undefined, (() => proc) as never)
    launcher.launch([])
    proc.stdout.emit('data', Buffer.from('obs booting'))
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[obs] obs booting'))
    spy.mockRestore()
  })

  it('routes flatpak stderr through console.warn', () => {
    const proc = fakeChild()
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const launcher = new FlatpakObsLauncher(undefined, (() => proc) as never)
    launcher.launch([])
    proc.stderr.emit('data', Buffer.from('a warning'))
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[obs] a warning'))
    spy.mockRestore()
  })
})
