import { CH, type AppState, type AudioDevice, type StreamSettingsView, type MaskRect, type GameAudioPluginView, type DiscordTestResult, type AudioTestResult } from '../shared/state.js'
import type { PttBinding, PttCaptureResult } from '../shared/keys.js'

export interface IpcHandlers {
  getInitialState(): Promise<AppState>
  provision(): Promise<void>
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
  testDiscordWebhook(): Promise<DiscordTestResult>
  recordAudioTest(): Promise<AudioTestResult>
  setPttEnabled(enabled: boolean): Promise<void>
  setPttBinding(b: PttBinding): Promise<void>
  capturePttKey(): Promise<PttCaptureResult>
  unlockPassthrough(): Promise<{ ok: boolean; error?: string }>
  setMasksVisible(visible: boolean): Promise<void>
  appVersion(): Promise<string>
  getWhatsNew(): Promise<{ version: string; notes: string | null }>
  setLastSeenVersion(v: string): Promise<void>
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
  ipcMain.handle(CH.testDiscordWebhook, () => handlers.testDiscordWebhook())
  ipcMain.handle(CH.recordAudioTest, () => handlers.recordAudioTest())
  ipcMain.handle(CH.setPttEnabled, (_e: unknown, enabled: boolean) => handlers.setPttEnabled(enabled))
  ipcMain.handle(CH.setPttBinding, (_e: unknown, b: PttBinding) => handlers.setPttBinding(b))
  ipcMain.handle(CH.capturePttKey, () => handlers.capturePttKey())
  ipcMain.handle(CH.unlockPassthrough, () => handlers.unlockPassthrough())
  ipcMain.handle(CH.setMasksVisible, (_e: unknown, visible: boolean) => handlers.setMasksVisible(visible))
  ipcMain.handle(CH.appVersion, () => handlers.appVersion())
  ipcMain.handle(CH.getWhatsNew, () => handlers.getWhatsNew())
  ipcMain.handle(CH.setLastSeenVersion, (_e: unknown, v: string) => handlers.setLastSeenVersion(v))
  d.bindPush((channel, payload) => { /* bound to webContents.send by caller */ void channel; void payload })
}
