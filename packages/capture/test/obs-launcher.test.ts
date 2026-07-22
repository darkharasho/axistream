import { describe, expect, it, vi } from 'vitest'
import { FlatpakObsLauncher, OWNED_OBS_APP_ID } from '../src/obs-launcher.js'

function processStub() {
  return {
    stdout: { on: vi.fn() }, stderr: { on: vi.fn() },
    kill: vi.fn(), on: vi.fn(),
  }
}

describe('FlatpakObsLauncher', () => {
  it('launches and stops only the injected owned Flatpak app ID', () => {
    const child = processStub()
    const spawn = vi.fn(() => child as never)
    const launcher = new FlatpakObsLauncher(OWNED_OBS_APP_ID, spawn)

    launcher.launch(['--collection', 'AxiStream'])
    launcher.stopOwned()

    expect(spawn.mock.calls[0]).toEqual([
      'flatpak', ['run', 'link.axi.AxiStream.OBS', '--collection', 'AxiStream'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    ])
    expect(spawn.mock.calls[1]).toEqual([
      'flatpak', ['kill', 'link.axi.AxiStream.OBS'], { stdio: 'ignore' },
    ])
  })
})
