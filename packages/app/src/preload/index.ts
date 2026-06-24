import { contextBridge, ipcRenderer } from 'electron'
import { CH, type AppState, type LiveStats, type AxiApi } from '../shared/state.js'

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
  goLive: () => ipcRenderer.invoke(CH.goLive) as Promise<void>,
  stopStream: () => ipcRenderer.invoke(CH.stopStream) as Promise<void>,
  repairCapture: () => ipcRenderer.invoke(CH.repairCapture) as Promise<void>,
  onState: (cb) => sub<Partial<AppState>>(CH.evtState, cb),
  onStats: (cb) => sub<LiveStats>(CH.evtStats, cb),
  onPreview: (cb) => sub<string>(CH.evtPreview, cb),
}
contextBridge.exposeInMainWorld('axi', api)
