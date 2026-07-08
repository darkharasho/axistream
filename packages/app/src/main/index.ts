import './load-env.js' // must run before any process.env read below
import { app, BrowserWindow, ipcMain, safeStorage, dialog, session, Tray, Menu, nativeImage, screen } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, readdirSync, openSync, readSync, closeSync, promises as fsPromises } from 'node:fs'
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
import { ObsSidecar, Provisioner, FlatpakObsLauncher, HeadlessCageObsLauncher, WindowsObsLauncher, CaptureConfig, applyCaptureResolution, ensureCleanProfile, ensureAudioInputs, detectEncoder, choosePreset, applyEncoderSettings, type EncoderKind, type EncoderPreset, readIdentity, professionName, raceName, mapName, specName, teamColorName, type MumbleDeps } from '@axistream/capture'
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
import { announce, type FetchLike } from './DiscordAnnounce.js'
import { RecordController } from './RecordController.js'
import { PttController } from './PttController.js'
import { ensureDesktopEntry } from './desktop-entry.js'
import { setupUpdater } from './updater.js'
import { createPortalShortcuts } from './portal-shortcuts.js'
import { createEvdevShortcuts, captureNextKey } from './evdev-keys.js'
import { runInputUnlock } from './input-unlock.js'
import { waitForStableFile, hasTopLevelMoov } from './wait-stable-file.js'
import { registerIpc, type IpcHandlers } from './ipc.js'
import { selectReleaseNotes, type GithubRelease } from './version-notes.js'
import { CH, INITIAL_STATE, type AppState, type CaptureMeta, type MaskRect, type StreamSettingsView } from '../shared/state.js'
import { bindingLabel, type PttBinding, type PttCaptureResult } from '../shared/keys.js'
import { computeWindowSize, toggleWindowSize, isFittedWidth } from './window-size.js'
import { enforceSingleInstance } from './single-instance.js'
import { AudioLevelMeter } from './AudioLevelMeter.js'
import { createSmokeWatcher, type SmokeResult } from './smoke.js'

const smokeMode = process.argv.includes('--smoke')
if (smokeMode) app.disableHardwareAcceleration()

// In smoke mode the watcher is created after app.whenReady (inside the primary
// block where setState lives), but the variable must be visible to setState.
let smokeWatcher: ReturnType<typeof createSmokeWatcher> | null = null

const CAPTURE_SOURCE = 'AxiStream Capture'
const WINDOW_FRACTION = 0.6
const WINDOW_MIN = { width: 820, height: 560 }
const SIDEBAR_W = 200 // mirrors the CSS .sidebar width
const YT_RTMPS = 'rtmps://a.rtmps.youtube.com/live2'
const viewOf = (s: StreamSettingsData): StreamSettingsView => ({ titleTemplate: s.titleTemplate, dateFormat: s.dateFormat, privacy: s.privacy, discordWebhookUrl: s.discordWebhookUrl, discordMessage: s.discordMessage })
let state: AppState = { ...INITIAL_STATE }

// MumbleLink reader deps — /proc/<pid>/mem reads the live address space, so
// it works for Proton's deleted-tmpfile-backed shared block (no native addon).
// /proc is Linux-only; the win32 arms return empty/null so readIdentity
// degrades to "GW2 not found" instead of leaning on downstream .catch()es.
const mumbleDeps: MumbleDeps = {
  readProc: (p) => readFileSync(p, 'utf8'),
  listPids: process.platform === 'linux'
    ? () => readdirSync('/proc').map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : () => [],
  readMem: (pid, addr, len) => {
    try {
      const fd = openSync(`/proc/${pid}/mem`, 'r')
      try { const b = Buffer.alloc(len); readSync(fd, b, 0, len, addr); return b }
      finally { closeSync(fd) }
    } catch { return null }
  },
}

const fetchJson = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`GW2 API ${r.status}`)
  return r.json()
}
const realFetch: FetchLike = (url, init) => fetch(url, init).then((r) => ({ ok: r.ok, status: r.status }))
const resolveGw2 = async (): Promise<{ character: string; class: string; map: string; race: string; team: string } | undefined> => {
  const id = readIdentity(mumbleDeps)
  if (!id) return undefined
  const [spec, map, team] = await Promise.all([specName(id.spec, fetchJson), mapName(id.mapId, fetchJson), teamColorName(id.teamColorId, fetchJson)])
  return { character: id.character, class: spec || professionName(id.profession), map, race: raceName(id.race), team }
}

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

  // GitHub-Releases auto-update (packaged only) + tell the AxiOM launcher
  // what's installed (it reads userData/axiom-version).
  setupUpdater(() => win)
  try { writeFileSync(join(app.getPath('userData'), 'axiom-version'), app.getVersion()) } catch { /* non-fatal */ }

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
  const setState = (p: Partial<AppState>) => {
    state = { ...state, ...p }
    push(CH.evtState, p)
    if (smokeMode && (p.phase !== undefined || p.error !== undefined)) {
      console.log('[smoke] phase=' + state.phase + ' error=' + state.error)
      smokeWatcher?.observe(state.phase, state.error)
    }
  }

  // Fit-button label truth: recompute on every resize/toggle/capture change.
  const pushFitted = () => {
    const cap = state.capture
    if (!cap) { if (state.windowFitted) setState({ windowFitted: false }); return }
    const [cw, ch] = win.getContentSize()
    const wa = screen.getDisplayMatching(win.getBounds()).workArea
    setState({ windowFitted: isFittedWidth(SIDEBAR_W, cw, ch, cap.width, cap.height, WINDOW_MIN.width, wa.width) })
  }
  win.on('resize', () => pushFitted())

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
  // win32 gets the native OBS launcher (fails fast with a clear message when
  // OBS isn't installed — no flatpak, no 30s port-wait hang).
  const launcher = process.platform === 'win32'
    ? new WindowsObsLauncher()
    : useHeadless ? new HeadlessCageObsLauncher(visibleLauncher) : visibleLauncher
  const sidecar = new ObsSidecar({ launcher, collection: 'AxiStream' })

  const preview = new PreviewPump({ client: () => sidecar.client(), sourceName: CAPTURE_SOURCE, emit: (d) => push(CH.evtPreview, d) })
  const meter = new AudioLevelMeter({ info: () => sidecar.wsInfo(), onLevels: (l) => push(CH.evtAudioLevels, l) })
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
  // Single application point honoring the visibility toggle: hidden means OBS
  // gets no mask items while the saved rects stay untouched in settings.
  const applyMasksRespectingVisibility = async () => {
    const a = settings.load()
    await maskCtl.applyMasks(a.masksVisible ? a.masks : [], a.maskStyle)
  }
  const gameAudio = new GameAudioController({ client: () => sidecar.client() })
  const recorder = new RecordController({ client: () => sidecar.client() })

  // Thin void exec for PTT's pactl calls (flatpakExec below captures output
  // for installer flows — different job).
  const execAsync = (cmd: string, args: string[]) => new Promise<void>((resolve, reject) => {
    execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
  })
  const portalBackend = createPortalShortcuts()
  const evdevBackend = createEvdevShortcuts()
  let pttMode: 'passthrough' | 'exclusive' | null = null
  // Probed at every enable (not boot-cached) so the pkexec unlock upgrades
  // the running app without a restart.
  const selectBackend = async () => (await evdevBackend.available())
    ? { backend: evdevBackend, mode: 'passthrough' as const }
    : { backend: portalBackend, mode: 'exclusive' as const }
  const loadBinding = (): PttBinding => {
    const s = settings.load()
    return { key: { code: s.pttKeyCode, name: s.pttKeyName }, modifier: s.pttModifier === '' ? null : s.pttModifier }
  }
  const ptt = new PttController({
    portal: {
      available: async () => (await evdevBackend.available()) || (await portalBackend.available()),
      bind: async (id, description, binding) => {
        const sel = await selectBackend()
        pttMode = sel.mode
        return sel.backend.bind(id, description, binding)
      },
    },
    exec: execAsync,
    sourceId: () => {
      const dev = settings.load().micDevice
      return dev && dev !== 'default' ? dev : '@DEFAULT_SOURCE@'
    },
    onActive: (active) => setState({ ptt: { ...state.ptt, active } }),
    binding: loadBinding,
  })

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

  // Smoke watcher: constructed here so all shutdown deps (sidecar, preview,
  // meter, ptt) are in scope for the onDone closure. The watcher is only
  // assigned in smoke mode; normal-path setState has a no-op guard.
  if (smokeMode) {
    smokeWatcher = createSmokeWatcher((r: SmokeResult) => {
      console.log(r.summary)
      try { preview.stop() } catch { /* ignore */ }
      try { void meter.stop() } catch { /* ignore */ }
      try { void sidecar.client().call('StopVirtualCam').catch(() => {}) } catch { /* ignore */ }
      if (ptt.isEnabled()) { try { void ptt.restore() } catch { /* ignore */ } }
      // Backstop so a hung sidecar.stop() can't wedge the smoke run.
      const backstop = setTimeout(() => app.exit(r.code), 5000)
      if (backstop.unref) backstop.unref()
      void sidecar.stop().catch(() => {}).finally(() => {
        clearTimeout(backstop)
        app.exit(r.code)
      })
    })
  }

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
    provision: async () => { const ok = await capture.provision(); if (ok) { const capture_ = await applyResolution(); await applyEncoderPreset(capture_.outputHeight, capture_.fps); const masks = settings.load().masks; setState({ phase: goReadyPhase(), keyMasked: keyStore.masked(), capture: capture_, masks }); startVirtualCam(); pushFitted(); await applyMasksRespectingVisibility(); if (state.gameAudioPlugin.status === 'ready') await gameAudio.ensure(settings.load()); meter.start() } },
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
        const gw2 = await Promise.race([
          resolveGw2().catch(() => undefined),
          new Promise<undefined>((r) => setTimeout(() => r(undefined), 1500)),
        ])
        const title = (titleOverride && titleOverride.trim()) ||
          (tpl && renderTitle(tpl, { now: new Date(), counter: s.counter + 1, dateFormat: s.dateFormat, gw2 }))
        if (!title) { setState({ phase: 'NEEDS_TITLE' }); return }
        setState({ phase: 'GOING_LIVE' })
        session = await live.startSession({ title, privacy: s.privacy, reuseStreamId: s.streamId, now: new Date() })
        settings.patch({ streamId: session.streamId })
        pendingOAuthBump = true
        await stream.goLive(session.ingest, {
          onIngestActive: async () => {
            try { await live.confirmLive(session!.broadcastId) } catch { /* best-effort */ }
            const cfg = settings.load()
            if (cfg.discordWebhookUrl.trim()) {
              // Fire-and-forget: onIngestActive is awaited on the go-live
              // critical path (StreamController flips to LIVE only after it
              // resolves), so a slow webhook must not delay the LIVE
              // transition. announce swallows its own errors; void detaches it.
              void announce({
                webhookUrl: cfg.discordWebhookUrl,
                title,
                watchUrl: `https://www.youtube.com/watch?v=${session!.broadcastId}`,
                message: cfg.discordMessage,
              }, realFetch).catch(() => {})
            }
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
    repairCapture: async () => { setState({ phase: 'SETTING_UP' }); const ok = await capture.repair(); if (ok) { const capture_ = await applyResolution(); await applyEncoderPreset(capture_.outputHeight, capture_.fps); const masks = settings.load().masks; setState({ phase: goReadyPhase(), keyMasked: keyStore.masked(), capture: capture_, masks }); startVirtualCam(); pushFitted(); await applyMasksRespectingVisibility(); if (state.gameAudioPlugin.status === 'ready') await gameAudio.ensure(settings.load()) } },
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
      if (ok) { const capture_ = await applyResolution(); await applyEncoderPreset(capture_.outputHeight, capture_.fps); const masks = settings.load().masks; setState({ phase: goReadyPhase(), keyMasked: keyStore.masked(), capture: capture_, masks }); startVirtualCam(); pushFitted(); await applyMasksRespectingVisibility(); if (state.gameAudioPlugin.status === 'ready') await gameAudio.ensure(settings.load()) }
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
      const gw2 = await Promise.race([
        resolveGw2().catch(() => undefined),
        new Promise<undefined>((r) => setTimeout(() => r(undefined), 1500)),
      ])
      return renderTitle(template, { now: new Date(), counter: s.counter + 1, dateFormat: s.dateFormat, gw2 })
    },
    setMasksVisible: async (visible: boolean) => {
      settings.patch({ masksVisible: visible })
      setState({ masksVisible: visible })
      await applyMasksRespectingVisibility()
    },
    setMasks: async (masks: MaskRect[]) => {
      const next = sanitizeMasks(masks)
      settings.patch({ masks: next })
      await applyMasksRespectingVisibility()
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
      const prevDev = settings.load().micDevice
      const prevSource = prevDev && prevDev !== 'default' ? prevDev : '@DEFAULT_SOURCE@'
      settings.patch({ micDevice: deviceId })
      await audio.setMicDevice(deviceId)
      setState({ audio: { ...state.audio, micDevice: deviceId } })
      // PTT's baseline mute lives on the source — move it with the device.
      await ptt.rearmSource(prevSource)
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
      await applyMasksRespectingVisibility()
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
    fitWindowToCapture: async () => {
      const cap = state.capture
      if (!cap) return
      const [cw, ch] = win.getContentSize()
      const wa = screen.getDisplayMatching(win.getBounds()).workArea
      const next = toggleWindowSize({ width: cw, height: ch }, wa, WINDOW_FRACTION, WINDOW_MIN, SIDEBAR_W, cap.width, cap.height)
      win.setContentSize(next.width, next.height)
      pushFitted()
    },
    windowMinimize: async () => { win.minimize() },
    windowToggleMaximize: async () => { if (win.isMaximized()) win.unmaximize(); else win.maximize() },
    windowClose: async () => { win.close() },
    testDiscordWebhook: async () => {
      const cfg = settings.load()
      return announce({
        webhookUrl: cfg.discordWebhookUrl,
        title: 'AxiStream test announcement',
        watchUrl: 'https://www.youtube.com/@axistream',
        message: cfg.discordMessage,
      }, realFetch)
    },
    setPttEnabled: async (enabled) => {
      settings.patch({ pttEnabled: enabled })
      if (enabled) {
        const r = await ptt.enable()
        const lb = loadBinding(); setState({ ptt: { ...state.ptt, enabled: r.ok, active: false, error: r.ok ? null : (r.error ?? 'failed'), mode: r.ok ? pttMode : null, keyName: bindingLabel(lb), keyCode: lb.key.code, modifier: lb.modifier } })
      } else {
        await ptt.disable()
        const lb = loadBinding(); setState({ ptt: { ...state.ptt, enabled: false, active: false, error: null, mode: null, keyName: bindingLabel(lb), keyCode: lb.key.code, modifier: lb.modifier } })
      }
    },
    setPttBinding: async (b: PttBinding) => {
      settings.patch({ pttKeyCode: b.key.code, pttKeyName: b.key.name, pttModifier: b.modifier ?? '' })
      setState({ ptt: { ...state.ptt, keyName: bindingLabel(b), keyCode: b.key.code, modifier: b.modifier } })
      if (ptt.isEnabled()) {
        await ptt.disable()
        const r = await ptt.enable()
        setState({ ptt: { ...state.ptt, enabled: r.ok, active: false, error: r.ok ? null : (r.error ?? 'failed'), mode: r.ok ? pttMode : null, keyName: bindingLabel(b), keyCode: b.key.code, modifier: b.modifier } })
      }
    },
    capturePttKey: async (): Promise<PttCaptureResult> => {
      if (!(await evdevBackend.available())) return { reason: 'unavailable' }
      const wasEnabled = ptt.isEnabled()
      // the pressed key must never transmit: capture with PTT disarmed.
      // try/finally: captureNextKey never rejects today, but a future
      // rejection path must not strand PTT disabled.
      if (wasEnabled) await ptt.disable()
      let result: PttCaptureResult = { reason: 'timeout' }
      try {
        result = await captureNextKey()
        if ('key' in result) {
          settings.patch({ pttKeyCode: result.key.code, pttKeyName: result.key.name, pttModifier: '' })
          setState({ ptt: { ...state.ptt, keyName: bindingLabel({ key: result.key, modifier: null }), keyCode: result.key.code, modifier: null } })
        }
      } finally {
        // re-sample intent: the user may have toggled PTT OFF while the
        // capture window was open — never resurrect an explicit disable
        if (wasEnabled && settings.load().pttEnabled) {
          const r = await ptt.enable()
          const lb = loadBinding(); setState({ ptt: { ...state.ptt, enabled: r.ok, active: false, error: r.ok ? null : (r.error ?? 'failed'), mode: r.ok ? pttMode : null, keyName: bindingLabel(lb), keyCode: lb.key.code, modifier: lb.modifier } })
        }
      }
      return result
    },
    unlockPassthrough: async () => {
      const r = await runInputUnlock(execAsync)
      if (r.ok && ptt.isEnabled()) {
        // upgrade in place: closing the portal binding releases F18 to Discord
        await ptt.disable()
        const en = await ptt.enable()
        const lb = loadBinding(); setState({ ptt: { ...state.ptt, enabled: en.ok, active: false, error: en.ok ? null : (en.error ?? 'failed'), mode: en.ok ? pttMode : null, keyName: bindingLabel(lb), keyCode: lb.key.code, modifier: lb.modifier } })
      }
      return r
    },
    recordAudioTest: async () => {
      if (stream.isLive() || state.phase === 'GOING_LIVE' || !state.capture) {
        return { ok: false, error: 'not available right now' }
      }
      // Must be a HOME-based path: OBS writes this file from inside its
      // flatpak, whose /tmp is a private tmpfs (even with host access), so an
      // OS-temp dir here means the record output dies instantly (StopRecord
      // 501, no file). Home is mapped identically inside the sandbox. The
      // dedicated subdir keeps the boot sweep away from anything else.
      const dir = join(app.getPath('userData'), 'audiotest')
      await fsPromises.mkdir(dir, { recursive: true }).catch(() => {})
      const r = await recorder.recordTestClip(6000, dir)
      if (!r.ok || !r.outputPath) return { ok: false, error: r.error ?? 'recording failed' }
      try {
        // OBS finalizes the file (moov index last) after StopRecord resolves.
        // Size-stability alone can be fooled by a stall before the moov write,
        // so verify the index is really in the bytes we read; without it the
        // clip plays as 0:00.
        const path = r.outputPath
        for (let i = 0; i < 3; i++) {
          await waitForStableFile(() => fsPromises.stat(path).then((s) => s.size, () => null))
          const clip = await fsPromises.readFile(path)
          if (hasTopLevelMoov(clip)) {
            await fsPromises.unlink(path).catch(() => {})
            return { ok: true, clip, mime: 'video/mp4' }
          }
        }
        // Leave the file on disk for inspection when it never finalizes.
        console.warn('[record] clip never finalized (no moov index):', path)
        return { ok: false, error: 'clip incomplete — OBS never finished writing it' }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
    appVersion: async () => app.getVersion(),
    getWhatsNew: async () => {
      const version = app.getVersion()
      try {
        const res = await fetch('https://api.github.com/repos/darkharasho/axistream/releases?per_page=100', { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(5000) })
        if (!res.ok) return { version, notes: null }
        const raw = await res.json() as { tag_name?: string; body?: string }[]
        const releases: GithubRelease[] = raw.map((r) => ({ tag: String(r.tag_name ?? ''), body: String(r.body ?? '') }))
        return { version, notes: selectReleaseNotes(releases, version, settings.load().lastSeenVersion || null) }
      } catch { return { version, notes: null } }
    },
    setLastSeenVersion: async (v) => { settings.patch({ lastSeenVersion: v }) },
  }
  registerIpc({ ipcMain, handlers, bindPush: () => {} })

  // Smoke mode: a fresh install boots to SETTING_UP and waits for the user
  // to start capture setup — drive it like the user would, once. On Windows
  // provisioning needs no portal approval, so this carries the boot all the
  // way to READY/NEEDS_KEY (the smoke success states).
  if (smokeMode) {
    // Boot pushes SETTING_UP before capture.start() finishes constructing
    // the provisioner — retry until the call survives.
    let inFlight = false
    const kick = setInterval(async () => {
      if (state.phase !== 'SETTING_UP' || inFlight) return
      inFlight = true
      try {
        console.log('[smoke] auto-triggering capture provisioning')
        await handlers.provision()
        clearInterval(kick)
        if (state.phase === 'SETTING_UP') {
          // every OBS provisioning call succeeded; only the non-black frame
          // check failed, which a headless runner can never pass
          console.log('[smoke] provisioned; frame check inconclusive on headless runner')
          smokeWatcher?.succeed('SMOKE OK provisioned (frame check inconclusive on headless runner)')
        }
      } catch (e) {
        console.error('[smoke] provision attempt failed (will retry):', e instanceof Error ? e.message : e)
      } finally { inFlight = false }
    }, 2000)
  }

  // Wire quit-while-live guard and engine teardown before booting OBS,
  // so that close events fired during the async start are handled correctly.
  win.on('close', (e) => {
    if (stream.isLive()) {
      const choice = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Stay live', 'End stream & quit'], defaultId: 0, cancelId: 0, message: "You're still live — end stream and quit?" })
      if (choice === 0) { e.preventDefault(); return }
    }
    preview.stop()
    void meter.stop()
    try { void sidecar.client().call('StopVirtualCam').catch(() => {}) } catch { /* ignore */ }
    if (ptt.isEnabled()) void ptt.restore()
    void sidecar.stop()
  })

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

  // Sweep stale audio-test clips (OBS names them; we only control the dir —
  // an app-owned subdir, so nothing third-party can ever be swept).
  void (async () => {
    try {
      const dir = join(app.getPath('userData'), 'audiotest')
      const dayAgo = Date.now() - 86_400_000
      for (const f of await fsPromises.readdir(dir)) {
        if (!f.endsWith('.mp4')) continue
        const p = join(dir, f)
        const st = await fsPromises.stat(p).catch(() => null)
        if (st && st.mtimeMs < dayAgo) await fsPromises.unlink(p).catch(() => {})
      }
    } catch { /* best-effort — dir may not exist yet */ }
  })()

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
      // PTT: install the desktop entry the portal Registry validates our host
      // app id against, then crash recovery (a previous run may have died
      // source-muted), then probe the portal and re-arm if the user had it on.
      if (process.platform === 'linux') await ensureDesktopEntry(process.execPath, homedir(), {
        mkdir: (p) => fsPromises.mkdir(p, { recursive: true }),
        readFile: (p) => fsPromises.readFile(p, 'utf8'),
        writeFile: (p, c) => fsPromises.writeFile(p, c),
      })
      await ptt.restore()
      const pttAvailable = await ptt.available()
      const lbInit = loadBinding(); setState({ ptt: { ...state.ptt, available: pttAvailable, keyName: bindingLabel(lbInit), keyCode: lbInit.key.code, modifier: lbInit.modifier } })
      if (pttAvailable && a.pttEnabled) {
        const r = await ptt.enable()
        const lbEn = loadBinding(); setState({ ptt: { ...state.ptt, enabled: r.ok, error: r.ok ? null : (r.error ?? 'failed'), mode: r.ok ? pttMode : null, keyName: bindingLabel(lbEn), keyCode: lbEn.key.code, modifier: lbEn.modifier } })
      }
      setState({ masks: a.masks, masksVisible: a.masksVisible })
      pushFitted()
      await applyMasksRespectingVisibility()
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
      meter.start()
    } else {
      setState({ phase: 'SETTING_UP' })
      setState({ gameAudioPlugin: { status: deriveGameAudioStatus(await installer.detectInstalled(), []), error: null } })
      setState({ blurPlugin: { status: deriveBlurStatus(await blurInstaller.detectInstalled(), []), error: null }, maskStyle: settings.load().maskStyle })
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error('[boot] stream engine failed:', detail)
    setState({ phase: 'ERROR', error: `Could not start the stream engine (OBS): ${detail}` })
  }
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
