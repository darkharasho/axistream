import { contextBridge, ipcRenderer } from 'electron'
import { CH, type AppState, type LiveStats, type AxiApi, type StreamSettingsView } from '../shared/state.js'

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
  windowMinimize: () => ipcRenderer.invoke(CH.windowMinimize) as Promise<void>,
  windowToggleMaximize: () => ipcRenderer.invoke(CH.windowToggleMaximize) as Promise<void>,
  windowClose: () => ipcRenderer.invoke(CH.windowClose) as Promise<void>,
  onState: (cb) => sub<Partial<AppState>>(CH.evtState, cb),
  onStats: (cb) => sub<LiveStats>(CH.evtStats, cb),
  onPreview: (cb) => sub<string>(CH.evtPreview, cb),
  onCaptureChanged: (cb) => sub<void>(CH.evtCaptureChanged, () => cb()),
}
contextBridge.exposeInMainWorld('axi', api)
