import { app, BrowserWindow, ipcMain, safeStorage, dialog, session, Tray, Menu, nativeImage, screen } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'

// Disable OBS's own system-tray icon so only AxiStream's tray shows. Stopgap
// while OBS shares the user's config; the bundled-isolated OBS will own this.
function hideObsTray(): void {
  if (process.platform !== 'linux') return
  // OBS 30+ keeps user prefs in user.ini; older OBS used global.ini. Write both.
  const dir = join(homedir(), '.var/app/com.obsproject.Studio/config/obs-studio')
  for (const name of ['user.ini', 'global.ini']) {
    try {
      const ini = join(dir, name)
      if (!existsSync(ini)) continue
      let txt = readFileSync(ini, 'utf8')
      if (/^SysTrayEnabled\s*=.*$/m.test(txt)) txt = txt.replace(/^SysTrayEnabled\s*=.*$/m, 'SysTrayEnabled=false')
      else if (/\[BasicWindow\]/.test(txt)) txt = txt.replace('[BasicWindow]', '[BasicWindow]\nSysTrayEnabled=false')
      else txt += '\n[BasicWindow]\nSysTrayEnabled=false\n'
      writeFileSync(ini, txt)
    } catch { /* best-effort */ }
  }
}
import { ObsSidecar, Provisioner, FlatpakObsLauncher, HeadlessCageObsLauncher, CaptureConfig, applyCaptureResolution, ensureCleanProfile } from '@axistream/capture'
import { CaptureService } from './CaptureService.js'
import { StreamController } from './StreamController.js'
import { KeyStore } from './KeyStore.js'
import { PreviewPump } from './PreviewPump.js'
import { registerIpc, type IpcHandlers } from './ipc.js'
import { CH, INITIAL_STATE, type AppState, type CaptureMeta } from '../shared/state.js'
import { computeWindowSize } from './window-size.js'

const CAPTURE_SOURCE = 'AxiStream Capture'
const WINDOW_FRACTION = 0.6
const WINDOW_MIN = { width: 820, height: 560 }
let state: AppState = { ...INITIAL_STATE }

function createWindow(): BrowserWindow {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { width, height } = computeWindowSize(display.workArea, WINDOW_FRACTION, WINDOW_MIN)
  const win = new BrowserWindow({
    // transparent:true cuts out the rounded corners to the desktop (KWin has no
    // window-rounding effect on this system, so transparency — not backgroundColor
    // — is what makes the corners actually round). The preview <video> carries its
    // own border-radius so a hardware overlay can't punch square corners through.
    width, height, minWidth: WINDOW_MIN.width, minHeight: WINDOW_MIN.height, center: true,
    frame: false, transparent: true, backgroundColor: '#00000000', show: false,
    icon: join(import.meta.dirname, '../../build/icon.png'),
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  })
  win.once('ready-to-show', () => win.show())
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return win
}

app.whenReady().then(async () => {
  // Allow the renderer to consume the OBS Virtual Camera for the live preview.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'))
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media')

  const win = createWindow()

  // AxiStream's own tray icon (OBS's is disabled via hideObsTray below).
  const showWin = () => { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
  const tray = new Tray(nativeImage.createFromPath(join(import.meta.dirname, '../../build/icon.png')).resize({ width: 22, height: 22 }))
  tray.setToolTip('AxiStream')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show AxiStream', click: showWin },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]))
  tray.on('click', showWin)

  const push = (channel: string, payload: unknown) => { if (!win.isDestroyed()) win.webContents.send(channel, payload) }
  const setState = (p: Partial<AppState>) => { state = { ...state, ...p }; push(CH.evtState, p) }

  const keyStore = new KeyStore(join(app.getPath('userData'), 'key.bin'), safeStorage)
  const config = new CaptureConfig(join(app.getPath('userData'), 'capture.json'))
  const visibleLauncher = new FlatpakObsLauncher()
  const useHeadless = process.platform === 'linux' && !process.env.AXISTREAM_OBS_VISIBLE
  const launcher = useHeadless ? new HeadlessCageObsLauncher(visibleLauncher) : visibleLauncher
  const sidecar = new ObsSidecar({ launcher, collection: 'AxiStream' })

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
  // Start OBS's Virtual Camera so the renderer can show a real live preview.
  const startVirtualCam = () => { try { void sidecar.client().call('StartVirtualCam').catch(() => {}) } catch { /* sidecar not ready */ } }

  // Size OBS's canvas/output to the captured monitor (best-effort), then read
  // back what OBS *actually* has and report that to the UI. We read GetVideoSettings
  // rather than the value applyCaptureResolution computed because, on an
  // already-provisioned boot, the canvas-sizing step races the capture's first
  // frame (the scene-item transform reads 0 until the source renders) — which is
  // why the UI used to show the 1080p fallback even on a 3440×1440 monitor.
  // GetVideoSettings is always populated and persisted, so it never races.
  const applyResolution = async (): Promise<CaptureMeta> => {
    await applyCaptureResolution({ call: (r, p) => sidecar.client().call(r as never, p as never) })
    try {
      const v = await sidecar.client().call('GetVideoSettings') as {
        baseWidth: number; baseHeight: number; outputWidth: number; outputHeight: number
        fpsNumerator: number; fpsDenominator: number
      }
      const fps = v.fpsDenominator ? Math.round(v.fpsNumerator / v.fpsDenominator) : 60
      return { sourceLabel: 'Guild Wars 2', width: v.baseWidth, height: v.baseHeight, outputWidth: v.outputWidth, outputHeight: v.outputHeight, fps }
    } catch {
      return { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, outputWidth: 1920, outputHeight: 1080, fps: 60 }
    }
  }

  const handlers: IpcHandlers = {
    getInitialState: async () => state,
    provision: async () => { const ok = await capture.provision(); if (ok) { const capture_ = await applyResolution(); setState({ phase: goReadyPhase(), keyMasked: keyStore.masked(), capture: capture_ }); startVirtualCam() } },
    saveKey: async (key) => { keyStore.save(key); setState({ keyMasked: keyStore.masked(), phase: state.phase === 'NEEDS_KEY' ? 'READY' : state.phase }) },
    forgetKey: async () => { keyStore.forget(); setState({ keyMasked: null, phase: state.phase === 'READY' ? 'NEEDS_KEY' : state.phase }) },
    goLive: async () => { const key = keyStore.load(); if (!key) { setState({ phase: 'NEEDS_KEY' }); return } await stream.goLive(key) },
    stopStream: async () => { await stream.stop() },
    repairCapture: async () => { setState({ phase: 'SETTING_UP' }); const ok = await capture.repair(); if (ok) { const capture_ = await applyResolution(); setState({ phase: goReadyPhase(), keyMasked: keyStore.masked(), capture: capture_ }); startVirtualCam() } },
    switchSource: async () => {
      // Re-pick the captured screen/window. Under headless cage the desktop
      // portal picker only surfaces via a full capture rebuild (same flow as
      // first-time setup) — pressing the source's in-place "Reload" tears the
      // stream down to black without ever showing the picker. We drive the
      // rebuild but stay on the AWAITING_APPROVAL overlay (set by onApprovalNeeded
      // inside repair), so the user sees "approve the dialog" rather than the
      // first-run setup screen. The preview survives the OBS restart because
      // PreviewVideo re-acquires the virtual cam when it drops.
      const ok = await capture.repair()
      if (ok) { const capture_ = await applyResolution(); setState({ phase: goReadyPhase(), keyMasked: keyStore.masked(), capture: capture_ }); startVirtualCam() }
    },
    windowMinimize: async () => { win.minimize() },
    windowToggleMaximize: async () => { if (win.isMaximized()) win.unmaximize(); else win.maximize() },
    windowClose: async () => { win.close() },
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
    try { void sidecar.client().call('StopVirtualCam').catch(() => {}) } catch { /* ignore */ }
    void sidecar.stop()
  })

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

  // Boot the engine, then derive the initial phase.
  try {
    hideObsTray()
    await capture.start()
    // Move onto an AxiStream-owned profile with no external YouTube auth — a
    // profile carrying that auth makes OBS route go-live through its broadcast
    // flow, which silently no-ops headless and never pushes RTMP. Persists across
    // restarts, so it's a one-time switch in practice. Best-effort.
    await ensureCleanProfile({ call: (r, p) => sidecar.client().call(r as never, p as never) })
    const provisioned = config.load().provisioned
    if (provisioned) {
      const capture_ = await applyResolution()
      setState({ phase: keyStore.masked() ? 'READY' : 'NEEDS_KEY', keyMasked: keyStore.masked(), capture: capture_ })
      startVirtualCam()
    } else {
      setState({ phase: 'SETTING_UP' })
    }
  } catch (e) {
    setState({ phase: 'ERROR', error: 'Could not start the stream engine (OBS).' })
  }
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
