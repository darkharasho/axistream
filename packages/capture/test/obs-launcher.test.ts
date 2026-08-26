import { describe, expect, it, vi } from 'vitest'
import { FlatpakObsLauncher, OWNED_OBS_APP_ID } from '../src/obs-launcher.js'

function processStub() {
  const handlers: Record<string, (...a: any[]) => void> = {}
  return {
    stdout: { on: vi.fn() }, stderr: { on: vi.fn() },
    kill: vi.fn(), on: vi.fn(),
    once: vi.fn((ev: string, cb: (...a: any[]) => void) => { handlers[ev] = cb }),
    emit: (ev: string, ...a: any[]) => handlers[ev]?.(...a),
  }
}

describe('FlatpakObsLauncher', () => {
  it('launches and stops only the injected owned Flatpak app ID', async () => {
    const child = processStub()
    const spawn = vi.fn(() => child as never)
    const launcher = new FlatpakObsLauncher(OWNED_OBS_APP_ID, spawn)

    launcher.launch(['--collection', 'AxiStream'])
    const stopped = launcher.stopOwned()
    child.emit('exit', 0)
    await stopped

    expect(spawn.mock.calls[0]).toEqual([
      'flatpak', ['run', 'link.axi.AxiStream.OBS', '--collection', 'AxiStream'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    ])
    expect(spawn.mock.calls[1]).toEqual([
      'flatpak', ['kill', 'link.axi.AxiStream.OBS'], { stdio: 'ignore' },
    ])
  })

  it('stopOwned() resolves only once the `flatpak kill` child has exited', async () => {
    // stop() sequences the handle kill behind this; if it resolves immediately
    // the app can exit with OBS still winding down.
    const child = processStub()
    const launcher = new FlatpakObsLauncher(OWNED_OBS_APP_ID, vi.fn(() => child as never))
    let settled = false
    const stopped = launcher.stopOwned().then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    child.emit('exit', 0)
    await stopped
    expect(settled).toBe(true)
  })

  it('stopOwned() gives up on a wedged `flatpak kill` instead of blocking quit', async () => {
    const child = processStub()
    const launcher = new FlatpakObsLauncher(OWNED_OBS_APP_ID, vi.fn(() => child as never), 10)
    await expect(launcher.stopOwned()).resolves.toBeUndefined()
  })

  it('stopOwned() survives a spawn that throws', async () => {
    const launcher = new FlatpakObsLauncher(OWNED_OBS_APP_ID, vi.fn(() => { throw new Error('no flatpak') }) as never)
    await expect(launcher.stopOwned()).resolves.toBeUndefined()
  })
})
