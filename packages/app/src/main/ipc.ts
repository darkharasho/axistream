import { CH, type AppState } from '../shared/state.js'

export interface IpcHandlers {
  getInitialState(): Promise<AppState>
  provision(): Promise<void>
  saveKey(key: string): Promise<void>
  forgetKey(): Promise<void>
  goLive(): Promise<void>
  stopStream(): Promise<void>
  repairCapture(): Promise<void>
  windowMinimize(): Promise<void>
  windowToggleMaximize(): Promise<void>
  windowClose(): Promise<void>
}

export interface IpcDeps {
  ipcMain: { handle(ch: string, fn: (...a: any[]) => any): void }
  handlers: IpcHandlers
  bindPush(push: (channel: string, payload: unknown) => void): void
}

export function registerIpc(d: IpcDeps): void {
  const { ipcMain, handlers } = d
  ipcMain.handle(CH.getInitialState, () => handlers.getInitialState())
  ipcMain.handle(CH.provision, () => handlers.provision())
  ipcMain.handle(CH.saveKey, (_e: unknown, key: string) => handlers.saveKey(key))
  ipcMain.handle(CH.forgetKey, () => handlers.forgetKey())
  ipcMain.handle(CH.goLive, () => handlers.goLive())
  ipcMain.handle(CH.stopStream, () => handlers.stopStream())
  ipcMain.handle(CH.repairCapture, () => handlers.repairCapture())
  ipcMain.handle(CH.windowMinimize, () => handlers.windowMinimize())
  ipcMain.handle(CH.windowToggleMaximize, () => handlers.windowToggleMaximize())
  ipcMain.handle(CH.windowClose, () => handlers.windowClose())
  d.bindPush((channel, payload) => { /* bound to webContents.send by caller */ void channel; void payload })
}
