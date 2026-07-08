import { describe, it, expect } from 'vitest'
import { resolveWindowsObsExe, enableObsWebsocketServer } from '../src/windows-obs-launcher.js'

describe('resolveWindowsObsExe', () => {
  const env = {
    'ProgramFiles': 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    'LOCALAPPDATA': 'C:\\Users\\u\\AppData\\Local',
  }

  it('prefers the 64-bit Program Files install', () => {
    const exists = (p: string) => p === 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe'
    expect(resolveWindowsObsExe(env, exists)).toBe('C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe')
  })

  it('falls back through x86 and LOCALAPPDATA', () => {
    const target = 'C:\\Users\\u\\AppData\\Local\\Programs\\obs-studio\\bin\\64bit\\obs64.exe'
    const exists = (p: string) => p === target
    expect(resolveWindowsObsExe(env, exists)).toBe(target)
  })

  it('returns null when OBS is not installed', () => {
    expect(resolveWindowsObsExe(env, () => false)).toBeNull()
  })

  it('tolerates missing env vars', () => {
    expect(resolveWindowsObsExe({}, () => false)).toBeNull()
  })
})

describe('enableObsWebsocketServer', () => {
  function harness(existing: string | null) {
    const writes: Array<{ path: string; content: string }> = []
    const dirs: string[] = []
    return {
      writes, dirs,
      deps: {
        mkdir: (p: string) => { dirs.push(p) },
        read: () => existing,
        write: (path: string, content: string) => { writes.push({ path, content }) },
      },
    }
  }

  it('creates the config with server_enabled when missing', () => {
    const h = harness(null)
    enableObsWebsocketServer('C:\\Users\\x\\AppData\\Roaming', h.deps)
    expect(h.dirs[0]).toBe('C:\\Users\\x\\AppData\\Roaming\\obs-studio\\plugin_config\\obs-websocket')
    expect(h.writes).toHaveLength(1)
    expect(JSON.parse(h.writes[0].content)).toEqual({ server_enabled: true })
  })

  it('merges into an existing config, preserving other keys', () => {
    const h = harness('{"server_enabled": false, "auth_required": true, "server_port": 4455}')
    enableObsWebsocketServer('C:\\a', h.deps)
    expect(JSON.parse(h.writes[0].content)).toEqual({ server_enabled: true, auth_required: true, server_port: 4455 })
  })

  it('leaves an already-enabled config untouched', () => {
    const h = harness('{"server_enabled": true, "server_port": 4455}')
    enableObsWebsocketServer('C:\\a', h.deps)
    expect(h.writes).toHaveLength(0)
  })

  it('no-ops without APPDATA and recovers from corrupt JSON', () => {
    const h = harness('{nope')
    enableObsWebsocketServer(undefined, h.deps)
    expect(h.writes).toHaveLength(0)
    enableObsWebsocketServer('C:\\a', h.deps)
    expect(JSON.parse(h.writes[0].content)).toEqual({ server_enabled: true })
  })
})
