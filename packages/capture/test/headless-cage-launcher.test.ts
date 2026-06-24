import { describe, it, expect, vi } from 'vitest'
import { HeadlessCageObsLauncher } from '../src/headless-cage-launcher.js'

function fakeLauncher() {
  const handle = { kill: vi.fn(), onExit: vi.fn() }
  return { launch: vi.fn(() => handle), killApp: vi.fn(), handle }
}

describe('HeadlessCageObsLauncher', () => {
  it('wraps OBS in cage with the headless env when cage is available', () => {
    const fallback = fakeLauncher()
    let captured: any
    const spawnProcess = vi.fn((cmd: string, args: string[], env: NodeJS.ProcessEnv) => {
      captured = { cmd, args, env }
      return { kill: vi.fn(), onExit: vi.fn() }
    })
    const l = new HeadlessCageObsLauncher(fallback as any, { isCageAvailable: () => true, spawnProcess })
    l.launch(['--websocket_port', '4455', '--collection', 'AxiStream'])
    expect(captured.cmd).toBe('cage')
    expect(captured.args).toEqual(['--', 'flatpak', 'run', 'com.obsproject.Studio', '--websocket_port', '4455', '--collection', 'AxiStream'])
    expect(captured.env.WLR_BACKENDS).toBe('headless')
    expect(captured.env.WLR_HEADLESS_OUTPUTS).toBe('1')
    expect(captured.env.WLR_LIBINPUT_NO_DEVICES).toBe('1')
    expect(fallback.launch).not.toHaveBeenCalled()
  })

  it('delegates launch to the fallback when cage is unavailable', () => {
    const fallback = fakeLauncher()
    const spawnProcess = vi.fn()
    const l = new HeadlessCageObsLauncher(fallback as any, { isCageAvailable: () => false, spawnProcess })
    const h = l.launch(['--websocket_port', '4455'])
    expect(fallback.launch).toHaveBeenCalledWith(['--websocket_port', '4455'])
    expect(spawnProcess).not.toHaveBeenCalled()
    expect(h).toBe(fallback.handle)
  })

  it('killApp delegates to the fallback (flatpak kill)', () => {
    const fallback = fakeLauncher()
    const l = new HeadlessCageObsLauncher(fallback as any, { isCageAvailable: () => true })
    l.killApp()
    expect(fallback.killApp).toHaveBeenCalledOnce()
  })
})
