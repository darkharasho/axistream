import { app, BrowserWindow, ipcMain, safeStorage, dialog } from 'electron'
import { join } from 'node:path'
import { ObsSidecar, Provisioner, FlatpakObsLauncher, CaptureConfig } from '@axistream/capture'
import { CaptureService } from './CaptureService.js'
import { StreamController } from './StreamController.js'
import { KeyStore } from './KeyStore.js'
import { PreviewPump } from './PreviewPump.js'
import { registerIpc, type IpcHandlers } from './ipc.js'
import { CH, INITIAL_STATE, type AppState } from '../shared/state.js'

const CAPTURE_SOURCE = 'AxiStream Capture'
let state: AppState = { ...INITIAL_STATE }

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960, height: 620, frame: false, backgroundColor: '#0b0d12', show: false,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  })
  win.once('ready-to-show', () => win.show())
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return win
}

app.whenReady().then(async () => {
  const win = createWindow()
  const push = (channel: string, payload: unknown) => { if (!win.isDestroyed()) win.webContents.send(channel, payload) }
  const setState = (p: Partial<AppState>) => { state = { ...state, ...p }; push(CH.evtState, p) }

  const keyStore = new KeyStore(join(app.getPath('userData'), 'key.bin'), safeStorage)
  const config = new CaptureConfig(join(app.getPath('userData'), 'capture.json'))
  const sidecar = new ObsSidecar({ launcher: new FlatpakObsLauncher(), collection: 'AxiStream' })

  const preview = new PreviewPump({ client: () => sidecar.client(), sourceName: CAPTURE_SOURCE, emit: (d) => push(CH.evtPreview, d) })
  win.on('hide', () => preview.setVisible(false))
  win.on('show', () => preview.setVisible(true))
  win.on('minimize', () => preview.setVisible(false))
  win.on('restore', () => preview.setVisible(true))

  const capture = new CaptureService({
    sidecar,
    makeProvisioner: () => new Provisioner({ sidecar, config, platform: process.platform }),
    onApprovalNeeded: () => setState({ phase: 'AWAITING_APPROVAL' }),
    onPhase: (p, error) => setState({ phase: p, error: error ?? null }),
    onCrashed: () => setState({ phase: 'ERROR', error: 'Stream engine crashed — restart AxiStream.' }),
  })

  const stream = new StreamController({
    client: () => sidecar.client(),
    onPhase: (p, error) => setState({ phase: p, error: error ?? null }),
    onStats: (s) => push(CH.evtStats, s),
  })

  const goReadyPhase = () => keyStore.masked() ? 'READY' : 'NEEDS_KEY'

  const handlers: IpcHandlers = {
    getInitialState: async () => state,
    provision: async () => { const ok = await capture.provision(); if (ok) { setState({ phase: goReadyPhase(), keyMasked: keyStore.masked(), capture: { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, fps: 60 } }); preview.start() } },
    saveKey: async (key) => { keyStore.save(key); setState({ keyMasked: keyStore.masked(), phase: state.phase === 'NEEDS_KEY' ? 'READY' : state.phase }) },
    forgetKey: async () => { keyStore.forget(); setState({ keyMasked: null, phase: state.phase === 'READY' ? 'NEEDS_KEY' : state.phase }) },
    goLive: async () => { const key = keyStore.load(); if (!key) { setState({ phase: 'NEEDS_KEY' }); return } await stream.goLive(key) },
    stopStream: async () => { await stream.stop() },
    repairCapture: async () => { setState({ phase: 'SETTING_UP' }) },
  }
  registerIpc({ ipcMain, handlers, bindPush: () => {} })

  // Wire quit-while-live guard and engine teardown before booting OBS,
  // so that close events fired during the async start are handled correctly.
  win.on('close', (e) => {
    if (stream.isLive()) {
      const choice = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Stay live', 'End stream & quit'], defaultId: 0, cancelId: 0, message: "You're still live — end stream and quit?" })
      if (choice === 0) { e.preventDefault(); return }
    }
    preview.stop()
    void sidecar.stop()
  })

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

  // Boot the engine, then derive the initial phase.
  try {
    await capture.start()
    const provisioned = config.load().provisioned
    if (provisioned) {
      setState({ phase: keyStore.masked() ? 'READY' : 'NEEDS_KEY', keyMasked: keyStore.masked(), capture: { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, fps: 60 } })
      preview.start()
    } else {
      setState({ phase: 'SETTING_UP' })
    }
  } catch (e) {
    setState({ phase: 'ERROR', error: 'Could not start the stream engine (OBS).' })
  }
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
