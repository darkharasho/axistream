import { describe, it, expect, vi } from 'vitest'
import { CH, INITIAL_STATE } from '../src/shared/state.js'
import { registerIpc } from '../src/main/ipc.js'

describe('ipc contract', () => {
  it('registers a handler for every command channel', () => {
    const handled = new Set<string>()
    const ipcMain = { handle: (ch: string) => handled.add(ch) }
    const handlers = {
      getInitialState: vi.fn(), provision: vi.fn(),
      getCaptureTargets: vi.fn(), cancelCaptureSelection: vi.fn(),
      goLive: vi.fn(), stopStream: vi.fn(), repairCapture: vi.fn(),
      setMasks: vi.fn(),
      windowMinimize: vi.fn(), windowToggleMaximize: vi.fn(), windowClose: vi.fn(),
      getGameAudioPluginStatus: vi.fn(), installGameAudioPlugin: vi.fn(),
      setMaskStyle: vi.fn(), installBlurPlugin: vi.fn(), relaunchApp: vi.fn(),
      setGameAudioApps: vi.fn(), getGameAudioApps: vi.fn(),
      fitWindowToCapture: vi.fn(),
    }
    registerIpc({ ipcMain: ipcMain as any, handlers: handlers as any, bindPush: () => {} })
    const commandChannels = [
      CH.getInitialState, CH.provision, CH.getCaptureTargets, CH.cancelCaptureSelection,
      CH.goLive, CH.stopStream, CH.repairCapture,
      CH.setMasks,
      CH.windowMinimize, CH.windowToggleMaximize, CH.windowClose,
      CH.getGameAudioPluginStatus, CH.installGameAudioPlugin,
      CH.setMaskStyle, CH.installBlurPlugin, CH.relaunchApp,
      CH.setGameAudioApps, CH.getGameAudioApps,
      CH.fitWindowToCapture,
    ]
    for (const ch of commandChannels) expect(handled.has(ch)).toBe(true)
  })

  it('forwards the exact opaque capture target through provision IPC', async () => {
    const registered = new Map<string, (...args: any[]) => any>()
    const provision = vi.fn()
    registerIpc({
      ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => registered.set(channel, handler) } as any,
      handlers: { provision } as any,
      bindPush: () => {},
    })
    const target = { property: 'monitor_id', value: '{DISPLAY-GUID}', label: 'Display 2' }

    await registered.get(CH.provision)?.({}, target)

    expect(provision).toHaveBeenCalledWith(target)
  })

  it('initializes with no stale capture choices', () => {
    expect(INITIAL_STATE.captureTargets).toEqual([])
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
