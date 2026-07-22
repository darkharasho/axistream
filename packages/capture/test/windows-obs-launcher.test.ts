import { describe, expect, it, vi } from 'vitest'
import {
  WindowsObsLauncher,
  enableOwnedObsWebsocketServer,
  type WindowsProcessContainer,
} from '../src/windows-obs-launcher.js'

function child(pid = 4242) {
  return {
    pid,
    kill: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  }
}

describe('enableOwnedObsWebsocketServer', () => {
  it('writes only below the explicitly owned portable config root', () => {
    const writes: Array<{ path: string; content: string }> = []
    const deps = {
      mkdir: vi.fn(),
      read: vi.fn(() => '{"auth_required":true}'),
      write: vi.fn((path: string, content: string) => writes.push({ path, content })),
    }

    enableOwnedObsWebsocketServer('C:\\AxiStream\\obs-runtime\\32.1.2\\config', deps)

    expect(deps.mkdir).toHaveBeenCalledWith(
      'C:\\AxiStream\\obs-runtime\\32.1.2\\config\\obs-studio\\plugin_config\\obs-websocket',
    )
    expect(writes[0].path).toContain('C:\\AxiStream\\obs-runtime\\32.1.2\\config\\obs-studio')
    expect(JSON.parse(writes[0].content)).toEqual({ auth_required: true, server_enabled: true })
  })
})

describe('WindowsObsLauncher', () => {
  it('launches the explicit private executable with portable OBS 32 flags', () => {
    const proc = child()
    const container: WindowsProcessContainer = { assign: vi.fn(), close: vi.fn() }
    const spawn = vi.fn(() => proc as never)
    const launcher = new WindowsObsLauncher({
      executablePath: 'C:\\AxiStream\\obs-runtime\\32.1.2\\bin\\64bit\\obs64.exe',
      configRoot: 'C:\\AxiStream\\obs-runtime\\32.1.2\\config',
      spawn,
      createContainer: () => container,
      configureWebsocket: vi.fn(),
    })

    launcher.launch(['--collection', 'AxiStream'])

    expect(spawn).toHaveBeenCalledOnce()
    const [exe, args, opts] = spawn.mock.calls[0] as unknown as [string, string[], { cwd: string }]
    expect(exe).toBe('C:\\AxiStream\\obs-runtime\\32.1.2\\bin\\64bit\\obs64.exe')
    expect(args).toEqual(expect.arrayContaining([
      '--portable', '--disable-updater', '--disable-missing-files-check', '--multi',
      '--collection', 'AxiStream',
    ]))
    expect(args).not.toContain('--disable-shutdown-check')
    expect(opts.cwd).toBe('C:\\AxiStream\\obs-runtime\\32.1.2\\bin\\64bit')
    expect(container.assign).toHaveBeenCalledWith(4242)
  })

  it('kills only the newly spawned child when containment fails', () => {
    const proc = child()
    const container: WindowsProcessContainer = {
      assign: vi.fn(() => { throw new Error('AssignProcessToJobObject failed') }),
      close: vi.fn(),
    }
    const launcher = new WindowsObsLauncher({
      executablePath: 'C:\\AxiStream\\owned\\obs64.exe',
      configRoot: 'C:\\AxiStream\\owned\\config',
      spawn: vi.fn(() => proc as never),
      createContainer: () => container,
      configureWebsocket: vi.fn(),
    })

    expect(() => launcher.launch([])).toThrow('Could not contain AxiStream OBS')
    expect(proc.kill).toHaveBeenCalledOnce()
    expect(container.close).toHaveBeenCalledOnce()
  })

  it('stops only its tracked job and never performs an image-wide kill', async () => {
    const proc = child()
    const container: WindowsProcessContainer = { assign: vi.fn(), close: vi.fn() }
    const spawn = vi.fn(() => proc as never)
    const launcher = new WindowsObsLauncher({
      executablePath: 'C:\\AxiStream\\owned\\obs64.exe',
      configRoot: 'C:\\AxiStream\\owned\\config',
      spawn,
      createContainer: () => container,
      configureWebsocket: vi.fn(),
    })
    launcher.launch([])

    await launcher.stopOwned()

    expect(container.close).toHaveBeenCalledOnce()
    expect(proc.kill).toHaveBeenCalledOnce()
    expect(spawn).toHaveBeenCalledOnce()
  })
})
