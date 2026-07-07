import { CH, type AppState, type AudioDevice, type StreamSettingsView, type MaskRect, type GameAudioPluginView } from '../shared/state.js'

export interface IpcHandlers {
  getInitialState(): Promise<AppState>
  provision(): Promise<void>
  saveKey(key: string): Promise<void>
  forgetKey(): Promise<void>
  goLive(titleOverride?: string): Promise<void>
  stopStream(): Promise<void>
  repairCapture(): Promise<void>
  switchSource(): Promise<void>
  connectYouTube(): Promise<void>
  disconnectYouTube(): Promise<void>
  getSettings(): Promise<StreamSettingsView>
  saveSettings(p: Partial<StreamSettingsView>): Promise<StreamSettingsView>
  previewTitle(template: string): Promise<string>
  getAudioDevices(): Promise<AudioDevice[]>
  setDesktopEnabled(enabled: boolean): Promise<void>
  setMicEnabled(enabled: boolean): Promise<void>
  setMicDevice(deviceId: string): Promise<void>
  getDesktopDevices(): Promise<AudioDevice[]>
  setDesktopDevice(deviceId: string): Promise<void>
  setMasks(masks: MaskRect[]): Promise<void>
  windowMinimize(): Promise<void>
  windowToggleMaximize(): Promise<void>
  windowClose(): Promise<void>
  getGameAudioPluginStatus(): Promise<GameAudioPluginView>
  installGameAudioPlugin(): Promise<void>
  setMaskStyle(style: 'box' | 'blur'): Promise<void>
  installBlurPlugin(): Promise<void>
  relaunchApp(): Promise<void>
  setGameAudioApps(apps: string[]): Promise<void>
  getGameAudioApps(): Promise<AudioDevice[]>
  fitWindowToCapture(): Promise<void>
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
  ipcMain.handle(CH.goLive, (_e: unknown, title?: string) => handlers.goLive(title))
  ipcMain.handle(CH.stopStream, () => handlers.stopStream())
  ipcMain.handle(CH.repairCapture, () => handlers.repairCapture())
  ipcMain.handle(CH.switchSource, () => handlers.switchSource())
  ipcMain.handle(CH.connectYouTube, () => handlers.connectYouTube())
  ipcMain.handle(CH.disconnectYouTube, () => handlers.disconnectYouTube())
  ipcMain.handle(CH.getSettings, () => handlers.getSettings())
  ipcMain.handle(CH.saveSettings, (_e: unknown, p: Partial<StreamSettingsView>) => handlers.saveSettings(p))
  ipcMain.handle(CH.previewTitle, (_e: unknown, t: string) => handlers.previewTitle(t))
  ipcMain.handle(CH.getAudioDevices, () => handlers.getAudioDevices())
  ipcMain.handle(CH.setDesktopEnabled, (_e: unknown, enabled: boolean) => handlers.setDesktopEnabled(enabled))
  ipcMain.handle(CH.setMicEnabled, (_e: unknown, enabled: boolean) => handlers.setMicEnabled(enabled))
  ipcMain.handle(CH.setMicDevice, (_e: unknown, deviceId: string) => handlers.setMicDevice(deviceId))
  ipcMain.handle(CH.getDesktopDevices, () => handlers.getDesktopDevices())
  ipcMain.handle(CH.setDesktopDevice, (_e: unknown, deviceId: string) => handlers.setDesktopDevice(deviceId))
  ipcMain.handle(CH.setMasks, (_e: unknown, masks: MaskRect[]) => handlers.setMasks(masks))
  ipcMain.handle(CH.windowMinimize, () => handlers.windowMinimize())
  ipcMain.handle(CH.windowToggleMaximize, () => handlers.windowToggleMaximize())
  ipcMain.handle(CH.windowClose, () => handlers.windowClose())
  ipcMain.handle(CH.getGameAudioPluginStatus, () => handlers.getGameAudioPluginStatus())
  ipcMain.handle(CH.installGameAudioPlugin, () => handlers.installGameAudioPlugin())
  ipcMain.handle(CH.setMaskStyle, (_e: unknown, style: 'box' | 'blur') => handlers.setMaskStyle(style))
  ipcMain.handle(CH.installBlurPlugin, () => handlers.installBlurPlugin())
  ipcMain.handle(CH.relaunchApp, () => handlers.relaunchApp())
  ipcMain.handle(CH.setGameAudioApps, (_e: unknown, apps: string[]) => handlers.setGameAudioApps(apps))
  ipcMain.handle(CH.getGameAudioApps, () => handlers.getGameAudioApps())
  ipcMain.handle(CH.fitWindowToCapture, () => handlers.fitWindowToCapture())
  d.bindPush((channel, payload) => { /* bound to webContents.send by caller */ void channel; void payload })
}
