import { describe, it, expect, vi } from 'vitest'
import { CH } from '../src/shared/state.js'
import { registerIpc } from '../src/main/ipc.js'

describe('ipc contract', () => {
  it('registers a handler for every command channel', () => {
    const handled = new Set<string>()
    const ipcMain = { handle: (ch: string) => handled.add(ch) }
    const handlers = {
      getInitialState: vi.fn(), provision: vi.fn(), saveKey: vi.fn(),
      forgetKey: vi.fn(), goLive: vi.fn(), stopStream: vi.fn(), repairCapture: vi.fn(),
      setMasks: vi.fn(),
      windowMinimize: vi.fn(), windowToggleMaximize: vi.fn(), windowClose: vi.fn(),
      getGameAudioPluginStatus: vi.fn(), installGameAudioPlugin: vi.fn(), relaunchApp: vi.fn(),
      setGameAudioApps: vi.fn(), getGameAudioApps: vi.fn(),
    }
    registerIpc({ ipcMain: ipcMain as any, handlers: handlers as any, bindPush: () => {} })
    const commandChannels = [
      CH.getInitialState, CH.provision, CH.saveKey, CH.forgetKey,
      CH.goLive, CH.stopStream, CH.repairCapture,
      CH.setMasks,
      CH.windowMinimize, CH.windowToggleMaximize, CH.windowClose,
      CH.getGameAudioPluginStatus, CH.installGameAudioPlugin, CH.relaunchApp,
      CH.setGameAudioApps, CH.getGameAudioApps,
    ]
    for (const ch of commandChannels) expect(handled.has(ch)).toBe(true)
  })

  it('bindPush receives a push function that targets event channels', () => {
    let push: ((ch: string, p: unknown) => void) | null = null
    registerIpc({
      ipcMain: { handle: () => {} } as any,
      handlers: {} as any,
      bindPush: (fn) => { push = fn },
    })
    expect(typeof push).toBe('function')
  })
})
