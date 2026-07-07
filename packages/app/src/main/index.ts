import './load-env.js' // must run before any process.env read below
import { app, BrowserWindow, ipcMain, safeStorage, dialog, session, Tray, Menu, nativeImage, screen } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'

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
import { ObsSidecar, Provisioner, FlatpakObsLauncher, HeadlessCageObsLauncher, CaptureConfig, applyCaptureResolution, ensureCleanProfile, ensureAudioInputs, detectEncoder, choosePreset, applyEncoderSettings, type EncoderKind, type EncoderPreset } from '@axistream/capture'
import { CaptureService } from './CaptureService.js'
import { StreamController } from './StreamController.js'
import { AudioController } from './AudioController.js'
import { KeyStore } from './KeyStore.js'
import { TokenStore } from './TokenStore.js'
import { StreamSettings, sanitizeMasks, sanitizeGameAudioApps, type StreamSettingsData } from './StreamSettings.js'
import { YouTubeAuth } from './YouTubeAuth.js'
import { YouTubeLive } from './YouTubeLive.js'
import { renderTitle } from './TitleTemplate.js'
import { createLoopback } from './loopback.js'
import { shell } from 'electron'
import { PreviewPump } from './PreviewPump.js'
import { MaskController } from './MaskController.js'
import { PluginInstaller, deriveGameAudioStatus, deriveBlurStatus, GAME_AUDIO_PLUGIN_REF, BLUR_PLUGIN_REF } from './PluginInstaller.js'
import { GameAudioController } from './GameAudioController.js'
import { registerIpc, type IpcHandlers } from './ipc.js'
import { CH, INITIAL_STATE, type AppState, type CaptureMeta, type MaskRect, type StreamSettingsView } from '../shared/state.js'
import { computeWindowSize } from './window-size.js'
import { enforceSingleInstance } from './single-instance.js'

const CAPTURE_SOURCE = 'AxiStream Capture'
const WINDOW_FRACTION = 0.6
const WINDOW_MIN = { width: 820, height: 560 }
const YT_RTMPS = 'rtmps://a.rtmps.youtube.com/live2'
const viewOf = (s: StreamSettingsData): StreamSettingsView => ({ titleTemplate: s.titleTemplate, dateFormat: s.dateFormat, privacy: s.privacy })
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

// A second AxiStream would spawn a second OBS against the same profile and
// collection — both break. Second launches just focus the first window.
let focusMain: () => void = () => {}
const primary = enforceSingleInstance({
  requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
  quit: () => app.quit(),
  on: (e, cb) => { app.on(e, cb) },
}, () => focusMain())

if (primary) app.whenReady().then(async () => {
  // Allow the renderer to consume the OBS Virtual Camera for the live preview.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'))
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media')

  const win = createWindow()

  // AxiStream's own tray icon (OBS's is disabled via hideObsTray below).
  const showWin = () => { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
  focusMain = showWin
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

  const userData = app.getPath('userData')
  const keyStore = new KeyStore(join(userData, 'key.bin'), safeStorage)
  const tokenStore = new TokenStore(join(userData, 'yt-tokens.bin'), safeStorage)
  const settings = new StreamSettings(join(userData, 'stream.json'))
  const auth = new YouTubeAuth({
    store: tokenStore,
    config: { clientId: process.env.AXI_YT_CLIENT_ID ?? '', clientSecret: process.env.AXI_YT_CLIENT_SECRET ?? '' },
    openExternal: (u) => shell.openExternal(u),
    listen: createLoopback,
  })
  const live = new YouTubeLive({ accessToken: () => auth.accessToken() })
  const config = new CaptureConfig(join(userData, 'capture.json'))
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

  const audio = new AudioController({ client: () => sidecar.client() })
  const maskCtl = new MaskController({ client: () => sidecar.client() })
  const gameAudio = new GameAudioController({ client: () => sidecar.client() })

  const flatpakExec = (cmd: string, args: string[], timeoutMs: number) => new Promise<{ code: number; output: string }>((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = `${stdout ?? ''}${stderr ?? ''}`
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') { reject(err); return }
      // Non-ENOENT failures (nonzero exit, timeout kill) resolve with a nonzero code.
      resolve({ code: err ? ((err as { code?: number }).code as number ?? 1) : 0, output })
    })
  })
  const installer = new PluginInstaller({ exec: flatpakExec, ref: GAME_AUDIO_PLUGIN_REF })
  const blurInstaller = new PluginInstaller({ exec: flatpakExec, ref: BLUR_PLUGIN_REF })

  let encoderKind: EncoderKind = settings.load().preferSoftware
    ? 'x264'
    : detectEncoder({ platform: process.platform, existsSync, readdirSync })
  let currentPreset: EncoderPreset | null = null
  const applyEncoderPreset = async (outputHeight: number, fps: number, opts?: { tries?: number }): Promise<boolean> => {
    currentPreset = choosePreset(encoderKind, outputHeight, fps)
    setState({ encoder: currentPreset.label, videoBitrateKbps: currentPreset.videoBitrateKbps })
    return applyEncoderSettings({ call: (r, p) => sidecar.client().call(r as never, p as never), tries: opts?.tries }, currentPreset)
  }

  let pendingOAuthBump = false
  // Persist preferSoftware only if the x264 retry actually reaches LIVE —
  // a live retry proves the pipe was fine and the hardware encoder was the
  // problem. A retry that also fails (network outage) must not permanently
  // flip the install to software; next boot re-detects hardware.
  let pendingSoftwareFlip = false
  const stream = new StreamController({
    client: () => sidecar.client(),
    onPhase: (p, error) => {
      if (p === 'LIVE' && pendingOAuthBump) {
        pendingOAuthBump = false
        settings.bumpCounter()
      } else if ((p === 'ERROR' || p === 'READY') && pendingOAuthBump) {
        pendingOAuthBump = false
      }
      if (p === 'LIVE' && pendingSoftwareFlip) {
        pendingSoftwareFlip = false
        settings.patch({ preferSoftware: true })
      } else if ((p === 'ERROR' || p === 'READY') && pendingSoftwareFlip) {
        pendingSoftwareFlip = false
      }
      setState({ phase: p, error: error ?? null })
    },
    onStats: (s) => push(CH.evtStats, s),
    encoderLabel: () => currentPreset?.label ?? 'x264',
    onStartFailure: async () => {
      if (encoderKind === 'x264') return false
      encoderKind = 'x264'
      pendingSoftwareFlip = true
      return applyEncoderPreset(state.capture?.outputHeight ?? 1080, state.capture?.fps ?? 60, { tries: 3 })
    },
  })

  const goReadyPhase = () => keyStore.masked() ? 'READY' : 'NEEDS_KEY'
  // Start OBS's Virtual Camera so the renderer can show a real live preview, and
  // tell the renderer to (re)acquire it. After an OBS restart the v4l2 device
  // node can persist while its feed stops, so the renderer's stream freezes black
  // without firing 'ended'/'devicechange' — an explicit signal is what unsticks it.
  const startVirtualCam = () => {
    try { void sidecar.client().call('StartVirtualCam').catch(() => {}) } catch { /* sidecar not ready */ }
    push(CH.evtCaptureChanged, null)
  }

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
    getInitialState: async () => ({
      ...state,
      youtube: { connected: auth.isConnected(), channel: auth.channelTitle() },
      settings: viewOf(settings.load()),
    }),
    provision: async () => { const ok = await capture.provision(); if (ok) { const capture_ = await applyResolution(); await applyEncoderPreset(capture_.outputHeight, capture_.fps); const masks = settings.load().masks; setState({ phase: goReadyPhase(), keyMasked: keyStore.masked(), capture: capture_, masks }); startVirtualCam(); await maskCtl.applyMasks(masks, settings.load().maskStyle); if (state.gameAudioPlugin.status === 'ready') await gameAudio.ensure(settings.load()) } },
    saveKey: async (key) => { keyStore.save(key); setState({ keyMasked: keyStore.masked(), phase: state.phase === 'NEEDS_KEY' ? 'READY' : state.phase }) },
    forgetKey: async () => { keyStore.forget(); setState({ keyMasked: null, phase: state.phase === 'READY' ? 'NEEDS_KEY' : state.phase }) },
    goLive: async (titleOverride?: string) => {
      if (!auth.isConnected()) {
        // Manual-key mode: use the saved stream key
        const key = keyStore.load()
        if (!key) { setState({ phase: 'NEEDS_KEY' }); return }
        await stream.goLive({ server: YT_RTMPS, key })
        return
      }
      // OAuth mode
      let session: import('./YouTubeLive.js').LiveSession | null = null
      try {
        const s = settings.load()
        const tpl = s.titleTemplate.trim()
        const title = (titleOverride && titleOverride.trim()) ||
          (tpl && renderTitle(tpl, { now: new Date(), counter: s.counter + 1, dateFormat: s.dateFormat }))
        if (!title) { setState({ phase: 'NEEDS_TITLE' }); return }
        setState({ phase: 'GOING_LIVE' })
        session = await live.startSession({ title, privacy: s.privacy, reuseStreamId: s.streamId, now: new Date() })
        settings.patch({ streamId: session.streamId })
        pendingOAuthBump = true
        await stream.goLive(session.ingest, {
          onIngestActive: async () => {
            try { await live.confirmLive(session!.broadcastId) } catch { /* best-effort */ }
          },
          onStop: () => live.complete(session!.broadcastId),
        })
      } catch (e) {
        const humanMessage = e instanceof Error ? e.message : String(e)
        pendingOAuthBump = false
        setState({ phase: 'ERROR', error: humanMessage })
        if (session) { try { await live.complete(session.broadcastId) } catch { /* best-effort */ } }
      }
    },
    stopStream: async () => { await stream.stop() },
    repairCapture: async () => { setState({ phase: 'SETTING_UP' }); const ok = await capture.repair(); if (ok) { const capture_ = await applyResolution(); await applyEncoderPreset(capture_.outputHeight, capture_.fps); const masks = settings.load().masks; setState({ phase: goReadyPhase(), keyMasked: keyStore.masked(), capture: capture_, masks }); startVirtualCam(); await maskCtl.applyMasks(masks, settings.load().maskStyle); if (state.gameAudioPlugin.status === 'ready') await gameAudio.ensure(settings.load()) } },
    switchSource: async () => {
      // Re-pick the captured screen/window. Under headless cage the desktop
      // portal picker only surfaces via a full capture rebuild (same flow as
      // first-time setup) — pressing the source's in-place "Reload" tears the
      // stream down to black without ever showing the picker. We drive the
      // rebuild but stay on the AWAITING_APPROVAL overlay (set by onApprovalNeeded
      // inside repair), so the user sees "approve the dialog" rather than the
      // first-run setup screen. The preview survives the OBS restart because
      // PreviewVideo re-acquires the virtual cam when it drops.
      setState({ phase: 'AWAITING_APPROVAL' }) // show the spinner/overlay immediately
      const ok = await capture.repair()
      if (ok) { const capture_ = await applyResolution(); await applyEncoderPreset(capture_.outputHeight, capture_.fps); const masks = settings.load().masks; setState({ phase: goReadyPhase(), keyMasked: keyStore.masked(), capture: capture_, masks }); startVirtualCam(); await maskCtl.applyMasks(masks, settings.load().maskStyle); if (state.gameAudioPlugin.status === 'ready') await gameAudio.ensure(settings.load()) }
    },
    connectYouTube: async () => {
      await auth.connect()
      const title = await live.channelTitle().catch(() => null)
      auth.setChannelTitle(title)
      setState({ youtube: { connected: true, channel: title } })
    },
    disconnectYouTube: async () => {
      auth.disconnect()
      setState({ youtube: { connected: false, channel: null } })
    },
    getSettings: async () => viewOf(settings.load()),
    saveSettings: async (p) => {
      const next = settings.patch(p)
      const view = viewOf(next)
      setState({ settings: view })
      return view
    },
    previewTitle: async (template) => {
      const s = settings.load()
      return renderTitle(template, { now: new Date(), counter: s.counter + 1, dateFormat: s.dateFormat })
    },
    setMasks: async (masks: MaskRect[]) => {
      const next = sanitizeMasks(masks)
      settings.patch({ masks: next })
      await maskCtl.applyMasks(next, settings.load().maskStyle)
      setState({ masks: next })
    },
    getAudioDevices: () => audio.listMicDevices(),
    getDesktopDevices: () => audio.listDesktopDevices(),
    setDesktopDevice: async (deviceId: string) => {
      settings.patch({ desktopDevice: deviceId })
      await audio.setDesktopDevice(deviceId)
      setState({ audio: { ...state.audio, desktopDevice: deviceId } })
    },
    setDesktopEnabled: async (enabled: boolean) => {
      settings.patch({ desktopEnabled: enabled })
      await audio.setDesktopEnabled(enabled)
      let audioPatch: Partial<AppState['audio']> = { desktopEnabled: enabled }
      // Exclusivity, reverse direction: turning desktop audio on clears the
      // per-app selection (and mutes the game-audio input via ensure).
      if (enabled && state.audio.gameAudioApps.length > 0) {
        settings.patch({ gameAudioApps: [] })
        await gameAudio.ensure(settings.load())
        audioPatch = { ...audioPatch, gameAudioApps: [] }
      }
      setState({ audio: { ...state.audio, ...audioPatch } })
    },
    setMicEnabled: async (enabled: boolean) => {
      settings.patch({ micEnabled: enabled })
      await audio.setMicEnabled(enabled)
      setState({ audio: { ...state.audio, micEnabled: enabled } })
    },
    setMicDevice: async (deviceId: string) => {
      settings.patch({ micDevice: deviceId })
      await audio.setMicDevice(deviceId)
      setState({ audio: { ...state.audio, micDevice: deviceId } })
    },
    setGameAudioApps: async (apps: string[]) => {
      const next = sanitizeGameAudioApps(apps)
      settings.patch({ gameAudioApps: next })
      await gameAudio.ensure(settings.load())
      let audioPatch: Partial<AppState['audio']> = { gameAudioApps: next }
      // Exclusivity: per-app selection replaces desktop audio.
      if (next.length > 0 && state.audio.desktopEnabled) {
        settings.patch({ desktopEnabled: false })
        await audio.setDesktopEnabled(false)
        audioPatch = { ...audioPatch, desktopEnabled: false }
      }
      setState({ audio: { ...state.audio, ...audioPatch } })
    },
    getGameAudioApps: () => gameAudio.listApps(),
    getGameAudioPluginStatus: async () => state.gameAudioPlugin,
    installGameAudioPlugin: async () => {
      if (state.gameAudioPlugin.status === 'installing') return
      setState({ gameAudioPlugin: { status: 'installing', error: null } })
      const r = await installer.install()
      setState({ gameAudioPlugin: r.ok ? { status: 'installed', error: null } : { status: 'error', error: r.error ?? 'Install failed' } })
    },
    installBlurPlugin: async () => {
      if (state.blurPlugin.status === 'installing') return
      setState({ blurPlugin: { status: 'installing', error: null } })
      const r = await blurInstaller.install()
      setState({ blurPlugin: r.ok ? { status: 'installed', error: null } : { status: 'error', error: r.error ?? 'Install failed' } })
    },
    setMaskStyle: async (style: 'box' | 'blur') => {
      settings.patch({ maskStyle: style })
      await maskCtl.applyMasks(settings.load().masks, style)
      setState({ maskStyle: style })
    },
    relaunchApp: async () => {
      if (stream.isLive()) return
      // Under `electron-vite dev` a relaunched instance escapes the dev
      // harness: the dev server exits with the old process, the new one
      // loads the stale out/ renderer, and it holds the single-instance
      // lock — blocking every subsequent `npm run dev`. In dev, just quit;
      // the developer reruns dev. Packaged builds get the real relaunch.
      if (!process.env.ELECTRON_RENDERER_URL) app.relaunch()
      app.quit()
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
      await applyEncoderPreset(capture_.outputHeight, capture_.fps)
      setState({ phase: keyStore.masked() ? 'READY' : 'NEEDS_KEY', keyMasked: keyStore.masked(), capture: capture_ })
      startVirtualCam()
      // Self-heal audio inputs on every boot — installs provisioned before the
      // audio feature never ran buildCollection again, so the inputs would be
      // missing. ensureAudioInputs is idempotent and best-effort.
      await ensureAudioInputs(sidecar.client())
      const a = settings.load()
      setState({ audio: { desktopEnabled: a.desktopEnabled, desktopDevice: a.desktopDevice, micEnabled: a.micEnabled, micDevice: a.micDevice, gameAudioApps: a.gameAudioApps } })
      await audio.applySettings({ desktopEnabled: a.desktopEnabled, desktopDevice: a.desktopDevice, micEnabled: a.micEnabled, micDevice: a.micDevice })
      setState({ masks: a.masks })
      await maskCtl.applyMasks(a.masks, a.maskStyle)
      const flatpakState = await installer.detectInstalled()
      let kinds: string[] = []
      try { kinds = ((await sidecar.client().call('GetInputKindList')) as { inputKinds?: string[] }).inputKinds ?? [] } catch { /* best-effort */ }
      console.info('[game-audio] input kinds', kinds)
      setState({ gameAudioPlugin: { status: deriveGameAudioStatus(flatpakState, kinds), error: null } })
      if (state.gameAudioPlugin.status === 'ready') await gameAudio.ensure(a)
      let filterKinds: string[] = []
      try { filterKinds = ((await sidecar.client().call('GetSourceFilterKindList')) as { sourceFilterKinds?: string[] }).sourceFilterKinds ?? [] } catch { /* best-effort */ }
      console.info('[blur] filter kinds', filterKinds)
      setState({ blurPlugin: { status: deriveBlurStatus(await blurInstaller.detectInstalled(), filterKinds), error: null }, maskStyle: a.maskStyle })
    } else {
      setState({ phase: 'SETTING_UP' })
      setState({ gameAudioPlugin: { status: deriveGameAudioStatus(await installer.detectInstalled(), []), error: null } })
      setState({ blurPlugin: { status: deriveBlurStatus(await blurInstaller.detectInstalled(), []), error: null }, maskStyle: settings.load().maskStyle })
    }
  } catch (e) {
    setState({ phase: 'ERROR', error: 'Could not start the stream engine (OBS).' })
  }
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
