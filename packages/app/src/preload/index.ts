import { contextBridge, ipcRenderer } from 'electron'
import { CH, type AppState, type AudioDevice, type LiveStats, type AxiApi, type StreamSettingsView, type MaskRect, type GameAudioPluginView, type AudioLevels, type DiscordTestResult } from '../shared/state.js'

const sub = <T,>(channel: string, cb: (p: T) => void) => {
  const listener = (_e: unknown, p: T) => cb(p)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: AxiApi = {
  getInitialState: () => ipcRenderer.invoke(CH.getInitialState) as Promise<AppState>,
  provision: () => ipcRenderer.invoke(CH.provision) as Promise<void>,
  saveKey: (key) => ipcRenderer.invoke(CH.saveKey, key) as Promise<void>,
  forgetKey: () => ipcRenderer.invoke(CH.forgetKey) as Promise<void>,
  goLive: (title) => ipcRenderer.invoke(CH.goLive, title) as Promise<void>,
  stopStream: () => ipcRenderer.invoke(CH.stopStream) as Promise<void>,
  repairCapture: () => ipcRenderer.invoke(CH.repairCapture) as Promise<void>,
  switchSource: () => ipcRenderer.invoke(CH.switchSource) as Promise<void>,
  connectYouTube: () => ipcRenderer.invoke(CH.connectYouTube) as Promise<void>,
  disconnectYouTube: () => ipcRenderer.invoke(CH.disconnectYouTube) as Promise<void>,
  getSettings: () => ipcRenderer.invoke(CH.getSettings) as Promise<StreamSettingsView>,
  saveSettings: (p) => ipcRenderer.invoke(CH.saveSettings, p) as Promise<StreamSettingsView>,
  previewTitle: (t) => ipcRenderer.invoke(CH.previewTitle, t) as Promise<string>,
  getAudioDevices: () => ipcRenderer.invoke(CH.getAudioDevices) as Promise<AudioDevice[]>,
  setDesktopEnabled: (enabled) => ipcRenderer.invoke(CH.setDesktopEnabled, enabled) as Promise<void>,
  setMicEnabled: (enabled) => ipcRenderer.invoke(CH.setMicEnabled, enabled) as Promise<void>,
  setMicDevice: (deviceId) => ipcRenderer.invoke(CH.setMicDevice, deviceId) as Promise<void>,
  getDesktopDevices: () => ipcRenderer.invoke(CH.getDesktopDevices) as Promise<AudioDevice[]>,
  setDesktopDevice: (deviceId) => ipcRenderer.invoke(CH.setDesktopDevice, deviceId) as Promise<void>,
  setMasks: (masks) => ipcRenderer.invoke(CH.setMasks, masks) as Promise<void>,
  windowMinimize: () => ipcRenderer.invoke(CH.windowMinimize) as Promise<void>,
  windowToggleMaximize: () => ipcRenderer.invoke(CH.windowToggleMaximize) as Promise<void>,
  windowClose: () => ipcRenderer.invoke(CH.windowClose) as Promise<void>,
  getGameAudioPluginStatus: () => ipcRenderer.invoke(CH.getGameAudioPluginStatus) as Promise<GameAudioPluginView>,
  installGameAudioPlugin: () => ipcRenderer.invoke(CH.installGameAudioPlugin) as Promise<void>,
  setMaskStyle: (style) => ipcRenderer.invoke(CH.setMaskStyle, style) as Promise<void>,
  installBlurPlugin: () => ipcRenderer.invoke(CH.installBlurPlugin) as Promise<void>,
  relaunchApp: () => ipcRenderer.invoke(CH.relaunchApp) as Promise<void>,
  setGameAudioApps: (apps) => ipcRenderer.invoke(CH.setGameAudioApps, apps) as Promise<void>,
  getGameAudioApps: () => ipcRenderer.invoke(CH.getGameAudioApps) as Promise<AudioDevice[]>,
  fitWindowToCapture: () => ipcRenderer.invoke(CH.fitWindowToCapture) as Promise<void>,
  testDiscordWebhook: () => ipcRenderer.invoke(CH.testDiscordWebhook) as Promise<DiscordTestResult>,
  onState: (cb) => sub<Partial<AppState>>(CH.evtState, cb),
  onStats: (cb) => sub<LiveStats>(CH.evtStats, cb),
  onPreview: (cb) => sub<string>(CH.evtPreview, cb),
  onCaptureChanged: (cb) => sub<void>(CH.evtCaptureChanged, () => cb()),
  onAudioLevels: (cb) => sub<AudioLevels>(CH.evtAudioLevels, cb),
}
contextBridge.exposeInMainWorld('axi', api)
