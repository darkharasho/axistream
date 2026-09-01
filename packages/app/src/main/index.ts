import './load-env.js' // must run before any process.env read below
import { app, BrowserWindow, ipcMain, safeStorage, dialog, session, Tray, Menu, nativeImage, screen, clipboard } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, readdirSync, openSync, readSync, closeSync, promises as fsPromises, constants as fsConstants } from 'node:fs'
import { homedir, release } from 'node:os'
import { execFile } from 'node:child_process'

import { OwnedObsSidecar, Provisioner, WindowsOwnedObsRuntime, LinuxOwnedObsRuntime, CaptureConfig, applyCaptureResolution, ensureCleanProfile, ensureAudioInputs, detectEncoder, choosePreset, applyEncoderSettings, type EncoderKind, type EncoderPreset, readIdentity, professionName, raceName, mapName, specName, teamColorName, type MumbleDeps, type OwnedObsRuntime, type LinuxObsRuntimeManifest, type WindowsObsRuntimeManifest } from '@axistream/capture'
import { CaptureService } from './CaptureService.js'
import { StreamController } from './StreamController.js'
import { AudioController } from './AudioController.js'
import { TokenStore } from './TokenStore.js'
import { StreamSettings, sanitizeMasks, sanitizeGameAudioApps, sanitizeWebcam, type StreamSettingsData } from './StreamSettings.js'
import { qualityOf, qualityPatchOf, qualityViewOf } from './quality.js'
import { shouldShowWelcome } from './onboarding.js'
import { WebcamController } from './WebcamController.js'
import { webcamToast } from './webcam-availability.js'
import { YouTubeAuth } from './YouTubeAuth.js'
import { YouTubeLive, watchUrlFor } from './YouTubeLive.js'
import { renderTitle } from './TitleTemplate.js'
import { createLoopback } from './loopback.js'
import { shell } from 'electron'
import { PreviewPump } from './PreviewPump.js'
import { MaskController } from './MaskController.js'
import { PluginInstaller, deriveGameAudioStatus, deriveBlurStatus, GAME_AUDIO_PLUGIN_REF, BLUR_PLUGIN_REF } from './PluginInstaller.js'
import { GameAudioController } from './GameAudioController.js'
import { announce, type FetchLike } from './DiscordAnnounce.js'
import { RecordController } from './RecordController.js'
import { defaultRecordDir, validateRecordDir, RECORD_DIR_ERROR } from './record-dir.js'
import { recordStartRejection } from './record-gate.js'
import { createRecordingFinalizer } from './record-finalize.js'
import { createSidecarTeardown } from './quit-teardown.js'
import { isInAppNavigation } from './navigate-gate.js'
import { createSummaryAccumulator } from './stream-summary.js'
import { PttController } from './PttController.js'
import { HotkeyService, type HotkeyActions } from './HotkeyService.js'
import { rebuildHotkeys as rebuildHotkeysCore, pttStateFields } from './rebuild-hotkeys.js'
import { selectHotkeyBackend } from './select-backend.js'
import { findConflict, findActionOwner, toBinding, toPersisted, type HotkeyBindings } from '../shared/hotkeys.js'
import { createWin32MuteOps } from './win32-mute-ops.js'
import { createWindowsKeys } from './windows-keys.js'
import { ensureDesktopEntry } from './desktop-entry.js'
import { setupUpdater } from './updater.js'
import { pollForLive } from './pollForLive.js'
import { createPortalShortcuts } from './portal-shortcuts.js'
import { createEvdevShortcuts, captureNextKey } from './evdev-keys.js'
import { runInputUnlock } from './input-unlock.js'
import { waitForStableFile, hasTopLevelMoov } from './wait-stable-file.js'
import { registerIpc, type IpcHandlers } from './ipc.js'
import { createLogSink, installLogSink } from './log.js'
import { collectDiagnostics } from './diagnostics.js'
import { scrubLine } from './redact.js'
import { selectReleaseNotes, type GithubRelease } from './version-notes.js'
import { CH, INITIAL_STATE, isStreamingPhase, type AppState, type CaptureMeta, type CaptureTargetOption, type MaskRect, type QualityPatch, type StreamSettingsView, type WebcamConfig } from '../shared/state.js'
import { bindingLabel, type PttBinding, type PttCaptureResult } from '../shared/keys.js'
import { computeWindowSize, toggleWindowSize, isFittedWidth } from './window-size.js'
import { enforceSingleInstance } from './single-instance.js'
import { AudioLevelMeter } from './AudioLevelMeter.js'
import { createSmokeWatcher, type SmokeResult } from './smoke.js'
import { toast } from './toast.js'

const runtimeOnlySmokeMode = process.argv.includes('--smoke-runtime')
const smokeMode = process.argv.includes('--smoke') || runtimeOnlySmokeMode
if (smokeMode) app.disableHardwareAcceleration()

// In smoke mode the watcher is created after app.whenReady (inside the primary
// block where setState lives), but the variable must be visible to setState.
let smokeWatcher: ReturnType<typeof createSmokeWatcher> | null = null

const CAPTURE_SOURCE = 'AxiStream Capture'
const WINDOW_FRACTION = 0.6
const WINDOW_MIN = { width: 820, height: 560 }
const SIDEBAR_W = 200 // mirrors the CSS .sidebar width
const viewOf = (s: StreamSettingsData): StreamSettingsView => ({ titleTemplate: s.titleTemplate, dateFormat: s.dateFormat, privacy: s.privacy, discordWebhookUrl: s.discordWebhookUrl, discordMessage: s.discordMessage, recordDir: s.recordDir })
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

/**
 * Hand a URL to the user's real browser — never to an in-app window.
 *
 * Electron's default for a target=_blank link is a chrome-less child window
 * loading the site with this app's webPreferences and no address bar. Only
 * http(s) is forwarded: an unvetted scheme out of renderer content is an OS
 * command surface.
 */
function openWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    if (protocol !== 'https:' && protocol !== 'http:') return false
  } catch { return false }
  void shell.openExternal(url).catch((e) => console.warn('[shell] openExternal failed', e))
  return true
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
  // Belt and braces behind axi.openExternalUrl: any window.open or stray
  // external href leaves the app instead of opening a chrome-less child window.
  win.webContents.setWindowOpenHandler(({ url }) => { openWebUrl(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e, url) => {
    if (isInAppNavigation(url, win.webContents.getURL())) return
    e.preventDefault()
    openWebUrl(url)
  })
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
  // Everything below can fail; all of it should land in the log.
  const logSink = createLogSink({ dir: app.getPath('logs'), scrub: scrubLine })
  installLogSink(logSink)

  // Allow the renderer to consume the OBS Virtual Camera for the live preview.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'))
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media')

  const win = createWindow()

  // GitHub-Releases auto-update (packaged only) + tell the AxiOM launcher
  // what's installed (it reads userData/axiom-version).
  setupUpdater(() => win)
  try { writeFileSync(join(app.getPath('userData'), 'axiom-version'), app.getVersion()) } catch { /* non-fatal */ }

  // AxiStream's own tray icon. OBS has no tray of its own to collide with:
  // it runs headless under cage on its own AxiStream profile.
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
  const tokenStore = new TokenStore(join(userData, 'yt-tokens.bin'), safeStorage)
  const settings = new StreamSettings(join(userData, 'stream.json'))
  const resolveRecordDir = () => {
    const saved = settings.load().recordDir
    // Stored empty by default so the path follows the user's actual home
    // rather than being frozen into a settings file at first run.
    return saved || defaultRecordDir(app.getPath('home'))
  }
  setState({ recording: { ...state.recording, dir: resolveRecordDir() } })
  const auth = new YouTubeAuth({
    store: tokenStore,
    config: { clientId: process.env.AXI_YT_CLIENT_ID ?? '', clientSecret: process.env.AXI_YT_CLIENT_SECRET ?? '' },
    openExternal: (u) => shell.openExternal(u),
    listen: createLoopback,
  })
  const live = new YouTubeLive({ accessToken: () => auth.accessToken() })
  const runtimeAssetRoot = app.isPackaged
    ? join(process.resourcesPath, 'obs-runtime')
    : join(import.meta.dirname, '../../../../resources/obs-runtime')
  const linuxManifest = (): LinuxObsRuntimeManifest => {
    const safeFailure: LinuxObsRuntimeManifest = {
      engineId: 'axistream-obs-linux-32.1.2', obsVersion: '32.1.2',
      appId: 'link.axi.AxiStream.OBS', bundleSha256: '0'.repeat(64),
      expectedRef: 'app/link.axi.AxiStream.OBS/x86_64/stable',
      expectedCommit: 'unavailable', expectedOrigin: 'unavailable',
    }
    try {
      const parsed = JSON.parse(readFileSync(join(runtimeAssetRoot, 'linux', 'runtime-manifest.json'), 'utf8')) as LinuxObsRuntimeManifest
      if (
        parsed.engineId !== safeFailure.engineId || parsed.obsVersion !== safeFailure.obsVersion ||
        parsed.appId !== safeFailure.appId || !/^[a-f0-9]{64}$/.test(parsed.bundleSha256) ||
        parsed.expectedRef !== safeFailure.expectedRef || !parsed.expectedCommit || !parsed.expectedOrigin
      ) return safeFailure
      return parsed
    } catch { return safeFailure }
  }
  const windowsRuntime = (): WindowsOwnedObsRuntime => {
    // The pinned runtime is defined once, in resources/obs-runtime/manifest.json.
    // Fail closed: a missing/corrupt manifest yields an all-zero hash so the runtime
    // rejects every archive and disables capture rather than trusting an unpinned build.
    const safeManifest: WindowsObsRuntimeManifest = {
      engineId: 'axistream-obs-windows-32.1.2', obsVersion: '32.1.2',
      archiveSha256: '0'.repeat(64), executableRelativePath: 'bin/64bit/obs64.exe',
    }
    let manifest = safeManifest
    let archiveFile = 'OBS-Studio-32.1.2-Windows-x64.zip'
    try {
      const parsed = JSON.parse(readFileSync(join(runtimeAssetRoot, 'manifest.json'), 'utf8')) as { windows?: Record<string, unknown> }
      const w = parsed.windows
      if (
        w && typeof w['engineId'] === 'string' && w['engineId'] &&
        typeof w['obsVersion'] === 'string' && w['obsVersion'] &&
        typeof w['archiveSha256'] === 'string' && /^[a-f0-9]{64}$/.test(w['archiveSha256']) &&
        typeof w['executableRelativePath'] === 'string' && w['executableRelativePath'] &&
        typeof w['archiveFile'] === 'string' && w['archiveFile']
      ) {
        manifest = {
          engineId: w['engineId'], obsVersion: w['obsVersion'],
          archiveSha256: w['archiveSha256'], executableRelativePath: w['executableRelativePath'],
        }
        archiveFile = w['archiveFile']
      }
    } catch { /* keep fail-closed safeManifest */ }
    return new WindowsOwnedObsRuntime({
      manifest,
      archivePath: join(runtimeAssetRoot, 'windows', archiveFile),
      installRoot: join(process.env.LOCALAPPDATA ?? userData, 'AxiStream', 'obs-runtime'),
    })
  }
  const runtime: OwnedObsRuntime = process.platform === 'win32'
    ? windowsRuntime()
    : process.platform === 'linux'
      ? new LinuxOwnedObsRuntime({
          manifest: linuxManifest(),
          bundlePath: join(runtimeAssetRoot, 'linux', 'AxiStream-OBS-32.1.2-x86_64.flatpak'),
          headless: !process.env.AXISTREAM_OBS_VISIBLE,
        })
      : {
          engineId: 'axistream-obs-unsupported', configIdentity: 'unavailable', configRoot: '',
          prepare: async () => { throw new Error('Capture is not supported on this platform') },
        }
  const config = new CaptureConfig(join(userData, 'capture.json'), runtime.engineId)
  const sidecar = new OwnedObsSidecar({ runtime, collection: 'AxiStream' })

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
    onTargets: (captureTargets) => setState({ captureTargets }),
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
  const webcamCtl = new WebcamController({ client: () => sidecar.client() })
  const applyWebcam = async () => {
    const cfg = settings.load().webcam
    const prev = state.webcam.available
    const { available } = await webcamCtl.apply(cfg)
    setState({ webcam: { ...cfg, available } })
    if (webcamToast(prev, available, cfg.enabled)) {
      toast(win, { kind: 'error', message: 'Camera unavailable', detail: cfg.deviceLabel ?? cfg.deviceId ?? undefined })
    }
  }
  const gameAudio = new GameAudioController({ client: () => sidecar.client() })
  const recorder = new RecordController({ client: () => sidecar.client() })
  const summaryAcc = createSummaryAccumulator()
  // A recording that finished DURING the current stream. recording.lastPath is
  // the last recording ever made and outlives the app's streams, so reporting
  // it in the summary would put Monday's recording in Tuesday's stream. Reset
  // at go-live alongside the stats accumulator.
  let sessionRecordingPath: string | null = null
  // OBS has exactly one record output, so the six-second audio test and a VOD
  // recording cannot coexist. state.audioTestActive is the audio test's half of
  // the mutual exclusion; the VOD's half is state.recording.active. It lives in
  // AppState rather than in a local so the Record button can disable itself and
  // explain why, instead of silently swallowing the rejection.
  // startRecording awaits a 300ms settle plus several websocket round-trips
  // before state.recording.active flips true. Without this flag, a "Test
  // audio" click landing in that window would race the VOD start and both
  // paths would stomp the same shared SimpleOutput profile parameters.
  let recordingStartInFlight = false
  // Polls OBS for a recording that died on its own (disk full, encoder
  // fault) so state.recording.active does not lie forever. Cleared on
  // explicit stop, on declared death, and on quit.
  let recordingHealthTimer: ReturnType<typeof setInterval> | null = null
  // clearInterval cannot cancel a tick already suspended in its await, so each
  // run of the poll carries a generation the tick re-checks after the await.
  // Without it, a tick that had already seen one miss resumes after a clean
  // Stop and declares the recording dead.
  let recordingHealthGeneration = 0

  const stopRecordingHealthPoll = () => {
    recordingHealthGeneration++
    if (recordingHealthTimer) { clearInterval(recordingHealthTimer); recordingHealthTimer = null }
  }
  // GetRecordStatus is polled rather than trusted on a single miss:
  // isRecording() swallows its own errors and returns false on a transient
  // websocket blip, so one false alone would misreport a healthy recording
  // as dead. Two consecutive false results is the death signal.
  const startRecordingHealthPoll = () => {
    stopRecordingHealthPoll()
    const generation = recordingHealthGeneration
    let consecutiveMisses = 0
    recordingHealthTimer = setInterval(() => {
      void (async () => {
        try {
          const alive = await recorder.isRecording()
          if (generation !== recordingHealthGeneration) return // stopped mid-tick
          if (alive) { consecutiveMisses = 0; return }
          consecutiveMisses++
          if (consecutiveMisses < 2) return
          stopRecordingHealthPoll()
          setState({ recording: { ...state.recording, active: false, startedAt: null, error: 'recording stopped unexpectedly' } })
          toast(win, { kind: 'error', message: 'Recording stopped unexpectedly', detail: 'OBS stopped writing the recording — check disk space.' })
          // If the summary is on screen, refresh it in place the same way
          // stopRecording does. No recordingPath here — there is no output
          // path from a death, and lastPath must not be invented.
          if (state.phase === 'ENDED' && state.summary) {
            setState({ summary: { ...state.summary, recordingStillActive: false } })
          }
        } catch {
          // best-effort: the poll must never throw out
        }
      })()
    }, 5000)
  }

  // Thin void exec for pactl calls (flatpakExec below captures output
  // for installer flows — different job).
  const execAsync = (cmd: string, args: string[]) => new Promise<void>((resolve, reject) => {
    execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
  })
  const warn = (...args: unknown[]) => console.warn(...args)
  const portalBackend = createPortalShortcuts()
  const evdevBackend = createEvdevShortcuts()
  const windowsBackend = createWindowsKeys()
  let pttMode: 'passthrough' | 'exclusive' | null = null
  // Probed at every rebuild (not boot-cached) so the pkexec unlock upgrades
  // the running app without a restart. The decision (including the win32
  // availability gate) lives in select-backend.ts as a pure function.
  const selectBackend = () => selectHotkeyBackend({
    platform: process.platform,
    windows: windowsBackend,
    evdev: evdevBackend,
    portal: portalBackend,
  })
  const loadBinding = (): PttBinding => {
    const s = settings.load()
    return { key: { code: s.pttKeyCode, name: s.pttKeyName }, modifier: s.pttModifier === '' ? null : s.pttModifier }
  }
  // Platform-specific mute ops: Linux gates the PipeWire source via pactl;
  // Windows gates the OBS input (SetInputMute on 'AxiStream Mic') — no Core Audio COM needed.
  const currentSourceId = () => {
    const dev = settings.load().micDevice
    return dev && dev !== 'default' ? dev : '@DEFAULT_SOURCE@'
  }
  const pttMuteOps = process.platform === 'win32'
    ? createWin32MuteOps({ call: (req, data) => sidecar.client().call(req as never, data as never) })
    : {
        mute: (m: boolean) => execAsync('pactl', ['set-source-mute', currentSourceId(), m ? '1' : '0']).catch(warn),
        unmuteById: (id: string) => execAsync('pactl', ['set-source-mute', id, '0']).catch(warn),
      }
  const ptt = new PttController({
    muteOps: pttMuteOps,
    onActive: (active) => setState({ ptt: { ...state.ptt, active } }),
    available: process.platform === 'win32'
      ? () => windowsBackend.available()
      : async () => (await evdevBackend.available()) || (await portalBackend.available()),
  })

  // The single reader for every persisted hotkey binding — shared between
  // HotkeyService's bindings() dep and the setHotkey conflict check so the
  // four toBinding calls live in exactly one place.
  const bindingsNow = (): HotkeyBindings => {
    const h = settings.load().hotkeys
    return { goLive: toBinding(h.goLive), micMute: toBinding(h.micMute), masks: toBinding(h.masks), record: toBinding(h.record) }
  }

  const hotkeyActions: HotkeyActions = {
    phase: () => state.phase,
    micEnabled: () => state.audio.micEnabled,
    masksVisible: () => state.masksVisible,
    recordingActive: () => state.recording.active,
    pttEnabled: () => ptt.isEnabled(),
    goLive: () => handlers.goLive(),
    stopStream: () => handlers.stopStream(),
    setMicEnabled: (e) => handlers.setMicEnabled(e),
    setMasksVisible: (v) => handlers.setMasksVisible(v),
    startRecording: () => handlers.startRecording(),
    stopRecording: () => handlers.stopRecording(),
    toast: (kind, message) => toast(win, { kind, message }),
  }

  const hotkeys = new HotkeyService({
    selectBackend,
    bindings: bindingsNow,
    // Push-to-talk only occupies a slot in the shared session while enabled.
    pttBinding: () => (settings.load().pttEnabled ? loadBinding() : null),
    actions: hotkeyActions,
    onPttEdge: (down) => ptt.onEdge(down),
    onMode: (mode) => {
      pttMode = mode
      setState({ hotkeys: { ...state.hotkeys, mode } })
    },
    now: () => Date.now(),
  })

  // Set for the duration of capturePttKey's raw evdev probe: any OTHER
  // handler's rebuildHotkeys() call during that window would reopen the
  // shared session mid-capture (re-arming PTT, re-binding the four action
  // hotkeys) while the probe is still reading the same devices — reopening
  // the exact hole closed below. capturePttKey's own finally rebuilds
  // unconditionally once the window closes, so a skipped rebuild self-heals.
  let captureInFlight = false

  // Every binding shares one session, so any change is a full close + bindAll.
  // In that gap NO hotkey is live, push-to-talk included. PTT's failure mode
  // is always "mic hot": arm (baseline-mute) ONLY on a successful rebuild —
  // never on a failed one, and explicitly disarm on failure so a mute left
  // over from a PREVIOUS successful arm doesn't strand the mic muted with no
  // watcher left to ever unmute it. The actual decision lives in
  // rebuild-hotkeys.ts, as a pure function, so it has direct unit coverage.
  const rebuildHotkeys = async (): Promise<{ ok: boolean; error?: string }> => {
    if (captureInFlight) return { ok: true }
    const r = await rebuildHotkeysCore({
      rebuild: () => hotkeys.rebuild(),
      pttEnabled: () => settings.load().pttEnabled,
      armPtt: () => ptt.arm(),
      disarmPtt: () => ptt.disarm(),
    })
    setState({ hotkeys: { ...state.hotkeys, error: r.ok ? null : (r.error ?? 'failed') } })
    return r
  }

  // The single reader for state.ptt after any rebuildHotkeys() call. The
  // enabled/error/mode derivation is a pure function (rebuild-hotkeys.ts)
  // with its own tests — see pttStateFields for why `error` is gated on
  // intent (settings.pttEnabled), not on the post-rebuild armed state.
  const pushPttState = (r: { ok: boolean; error?: string }) => {
    const lb = loadBinding()
    const fields = pttStateFields(r, { armed: ptt.isEnabled(), wantsPtt: settings.load().pttEnabled, mode: pttMode })
    setState({ ptt: { ...state.ptt, ...fields, keyName: bindingLabel(lb), keyCode: lb.key.code, modifier: lb.modifier } })
  }

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

  const detectKind = (): EncoderKind => settings.load().preferSoftware
    ? 'x264'
    : detectEncoder({ platform: process.platform, existsSync, readdirSync })
  let encoderKind: EncoderKind = detectKind()
  let currentPreset: EncoderPreset | null = null
  const applyEncoderPreset = async (outputHeight: number, fps: number, opts?: { tries?: number }): Promise<boolean> => {
    currentPreset = choosePreset(encoderKind, outputHeight, fps, qualityOf(settings.load()).overrides)
    setState({ encoder: currentPreset.label, videoBitrateKbps: currentPreset.videoBitrateKbps })
    return applyEncoderSettings({ call: (r, p) => sidecar.client().call(r as never, p as never), tries: opts?.tries }, currentPreset)
  }

  let pendingOAuthBump = false
  let liveWatchStop = false
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
        const next = settings.patch({ preferSoftware: true, preferSoftwareAuto: true })
        setState({ quality: qualityViewOf(next) })
      } else if ((p === 'ERROR' || p === 'READY') && pendingSoftwareFlip) {
        pendingSoftwareFlip = false
      }
      setState({ phase: p, error: error ?? null })
    },
    onStats: (s) => { summaryAcc.sample(s); push(CH.evtStats, s) },
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

  const goReadyPhase = () => auth.isConnected() ? 'READY' : 'NEEDS_YOUTUBE'
  // Start OBS's Virtual Camera so the renderer can show a real live preview, and
  // tell the renderer to (re)acquire it. After an OBS restart the v4l2 device
  // node can persist while its feed stops, so the renderer's stream freezes black
  // without firing 'ended'/'devicechange' — an explicit signal is what unsticks it.
  // Tracked in virtualCamActive so applyResolutionLive knows whether it needs
  // to bracket SetVideoSettings.
  let virtualCamActive = false
  // Diagnostic only: the virtual cam is the in-app preview's entire feed, and on
  // Windows its DirectShow device keeps serving OBS's placeholder frame when the
  // output is stopped — so a failed (re)start looks identical to a working one
  // from the renderer's side and used to leave no trace at all. Log the call
  // outcome and read GetVirtualCamStatus back so the log says whether the output
  // actually came up. Still best-effort: never throws, never blocks the caller.
  const verifyVirtualCam = async (why: string): Promise<void> => {
    await new Promise((r) => setTimeout(r, 600))
    try {
      const st = await sidecar.client().call('GetVirtualCamStatus') as { outputActive?: boolean }
      if (st?.outputActive) console.log(`virtualcam: active after ${why}`)
      else console.warn(`virtualcam: NOT active after ${why} (preview will show the OBS placeholder)`)
    } catch (e) {
      console.warn(`virtualcam: status check failed after ${why}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const startVirtualCam = (why = 'start') => {
    virtualCamActive = true
    try {
      void sidecar.client().call('StartVirtualCam')
        .then(() => console.log(`virtualcam: StartVirtualCam ok (${why})`))
        .catch((e) => console.warn(`virtualcam: StartVirtualCam failed (${why}): ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => { void verifyVirtualCam(why) })
    } catch { console.warn(`virtualcam: sidecar not ready for StartVirtualCam (${why})`) }
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
    const q = qualityOf(settings.load())
    await applyCaptureResolution({
      call: (r, p) => sidecar.client().call(r as never, p as never),
      maxHeight: q.maxHeight,
      fps: q.fps,
    })
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

  // applyResolution's SetVideoSettings does obs_reset_video, which OBS refuses
  // with OBS_VIDEO_CURRENTLY_ACTIVE while any output is active — including the
  // virtual cam that drives the in-app preview. provision/repairCapture/
  // switchSource/boot all call applyResolution before the cam is ever started,
  // so they're unaffected. goLive and setQuality can run with the cam already
  // live, so they go through this instead: stop the cam, apply, restart it.
  // Best-effort throughout — a stop/restart failure must never throw out of
  // goLive or setQuality. The preview blinks on a resolution change; accepted.
  const applyResolutionLive = async (why = 'applyResolutionLive'): Promise<CaptureMeta> => {
    if (!virtualCamActive) { console.log(`virtualcam: ${why} ran with the cam already stopped; no bracket`); return applyResolution() }
    console.log(`virtualcam: ${why} bracket - stopping cam for SetVideoSettings`)
    try { await sidecar.client().call('StopVirtualCam'); console.log('virtualcam: StopVirtualCam ok') }
    catch (e) { console.warn(`virtualcam: StopVirtualCam failed: ${e instanceof Error ? e.message : String(e)}`) }
    virtualCamActive = false
    try {
      return await applyResolution()
    } finally {
      startVirtualCam(`${why} bracket restart`)
    }
  }

  const handlers: IpcHandlers = {
    getInitialState: async () => ({
      ...state,
      youtube: { connected: auth.isConnected(), channel: auth.channelTitle() },
      settings: viewOf(settings.load()),
      // Seeded here as well as at the provisioned boot: the overrides live in
      // settings.json regardless of whether capture is provisioned, so an
      // unprovisioned boot must not report a stale "Auto".
      quality: qualityViewOf(settings.load()),
      // Same reasoning: the bindings live in settings.json regardless of
      // whether capture is provisioned, so an unprovisioned boot must not
      // report an empty registry.
      hotkeys: { bindings: bindingsNow(), mode: state.hotkeys.mode, error: state.hotkeys.error },
    }),
    provision: async (target?: CaptureTargetOption) => { const ok = await capture.provision(target); if (ok) { const capture_ = await applyResolution(); await applyEncoderPreset(capture_.outputHeight, capture_.fps); const masks = settings.load().masks; setState({ phase: goReadyPhase(), capture: capture_, captureTargets: [], masks }); startVirtualCam(); pushFitted(); await applyMasksRespectingVisibility(); await applyWebcam(); if (state.gameAudioPlugin.status === 'ready') await gameAudio.ensure(settings.load()); meter.start() } },
    getCaptureTargets: async () => capture.captureTargets(),
    cancelCaptureSelection: async () => capture.cancelSelection(),
    goLive: async (titleOverride?: string) => {
      if (!auth.isConnected()) { setState({ phase: 'NEEDS_YOUTUBE' }); return }
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
        // Bitrate and encoder are profile parameters OBS only reads at
        // StartStream, so a quality edit lands here. Unconditional rather
        // than flag-guarded: it is idempotent, best-effort, and cannot
        // desync the way a pending-change flag can.
        if (state.capture) {
          const capture_ = await applyResolutionLive('goLive')
          // Bounded retries: applyEncoderSettings otherwise falls back to
          // callReady's 25 tries x 800ms, and a websocket-level failure looks
          // retryable, so four SetProfileParameter calls could wedge
          // GOING_LIVE for ~80s before startSession is even attempted.
          await applyEncoderPreset(capture_.outputHeight, capture_.fps, { tries: 3 })
          setState({ capture: capture_ })
        }
        summaryAcc.reset()
        sessionRecordingPath = null
        setState({ summary: null })
        session = await live.startSession({ title, privacy: s.privacy, reuseStreamId: s.streamId, now: new Date() })
        settings.patch({ streamId: session.streamId })
        setState({ watchUrl: watchUrlFor(session.broadcastId) })
        pendingOAuthBump = true
        await stream.goLive(session.ingest, {
          onIngestActive: async () => {
            // Diagnostic: detached (this callback is awaited before the LIVE
            // transition) — records whether StartStream itself took the virtual
            // cam down, which is what the Windows "preview dies at go-live"
            // report can't otherwise distinguish from a failed bracket restart.
            void verifyVirtualCam('StartStream')
            liveWatchStop = false
            setState({ phase: 'STARTING_ON_YOUTUBE', liveUnconfirmed: false })
            const confirmed = await pollForLive({
              confirm: () => live.confirmLive(session!.broadcastId),
              pollMs: 3000,
              maxAttempts: 15, // ~45s
              shouldStop: () => liveWatchStop,
            })
            if (liveWatchStop) return
            setState({ liveUnconfirmed: !confirmed })
            if (!confirmed) {
              // Keep checking in the background; clear the warning if YouTube
              // starts the broadcast late. Cancelled by stopStream().
              void pollForLive({
                confirm: () => live.confirmLive(session!.broadcastId),
                pollMs: 5000,
                maxAttempts: Infinity,
                shouldStop: () => liveWatchStop,
              }).then((late) => { if (late) setState({ liveUnconfirmed: false }) })
            }
            const cfg = settings.load()
            if (cfg.discordWebhookUrl.trim()) {
              void announce({
                webhookUrl: cfg.discordWebhookUrl,
                title,
                watchUrl: watchUrlFor(session!.broadcastId),
                message: cfg.discordMessage,
              }, realFetch)
                .then((r) => {
                  if (!r.ok) toast(win, { kind: 'error', message: 'Discord announcement failed', detail: r.error })
                })
                .catch((e) => {
                  toast(win, { kind: 'error', message: 'Discord announcement failed', detail: String(e) })
                })
            }
          },
          onStop: () => live.complete(session!.broadcastId),
        })
      } catch (e) {
        const humanMessage = e instanceof Error ? e.message : String(e)
        pendingOAuthBump = false
        setState({ phase: 'ERROR', error: humanMessage, watchUrl: null })
        if (session) { try { await live.complete(session.broadcastId) } catch { /* best-effort */ } }
      }
    },
    stopStream: async () => {
      const wasUnconfirmed = state.liveUnconfirmed
      liveWatchStop = true
      setState({ liveUnconfirmed: false })
      // Snapshot before stopping: OBS's stats are instantaneous and gone once
      // the output closes, so nothing here can be recovered afterward.
      const summary = summaryAcc.snapshot({
        watchUrl: state.watchUrl,
        recordingPath: sessionRecordingPath,
        recordingStillActive: state.recording.active,
        endedWithError: state.phase === 'ERROR' || wasUnconfirmed,
      })
      await stream.stop()
      // stream.stop() drives onPhase to READY; the summary phase must win, so
      // it is set after.
      setState({ phase: 'ENDED', summary })
    },
    repairCapture: async () => { setState({ phase: 'SETTING_UP' }); const ok = await capture.repair(); if (ok) { const capture_ = await applyResolution(); await applyEncoderPreset(capture_.outputHeight, capture_.fps); const masks = settings.load().masks; setState({ phase: goReadyPhase(), capture: capture_, masks, summary: null }); startVirtualCam(); pushFitted(); await applyMasksRespectingVisibility(); await applyWebcam(); if (state.gameAudioPlugin.status === 'ready') await gameAudio.ensure(settings.load()) } },
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
      if (ok) { const capture_ = await applyResolution(); await applyEncoderPreset(capture_.outputHeight, capture_.fps); const masks = settings.load().masks; setState({ phase: goReadyPhase(), capture: capture_, masks, summary: null }); startVirtualCam(); pushFitted(); await applyMasksRespectingVisibility(); await applyWebcam(); if (state.gameAudioPlugin.status === 'ready') await gameAudio.ensure(settings.load()) }
    },
    connectYouTube: async () => {
      await auth.connect()
      const title = await live.channelTitle().catch(() => null)
      auth.setChannelTitle(title)
      setState({ youtube: { connected: true, channel: title }, phase: state.phase === 'NEEDS_YOUTUBE' ? 'READY' : state.phase })
    },
    disconnectYouTube: async () => {
      auth.disconnect()
      setState({ youtube: { connected: false, channel: null }, phase: state.phase === 'READY' ? 'NEEDS_YOUTUBE' : state.phase })
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
      // Installs finish in the background, often on another screen.
      toast(win, r.ok
        ? { kind: 'success', message: 'Game audio plugin installed' }
        : { kind: 'error', message: 'Game audio plugin install failed', detail: r.error })
    },
    installBlurPlugin: async () => {
      if (state.blurPlugin.status === 'installing') return
      setState({ blurPlugin: { status: 'installing', error: null } })
      const r = await blurInstaller.install()
      setState({ blurPlugin: r.ok ? { status: 'installed', error: null } : { status: 'error', error: r.error ?? 'Install failed' } })
      toast(win, r.ok
        ? { kind: 'success', message: 'Blur plugin installed' }
        : { kind: 'error', message: 'Blur plugin install failed', detail: r.error })
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
      // Every binding shares one session: disabling is the one case that
      // must ALSO disarm the local mute state explicitly — rebuildHotkeys'
      // internal `if pttEnabled` re-arm gate is now false, so it won't do it
      // for us. Enabling is handled entirely by that same gate.
      if (!enabled) await ptt.disarm()
      const r = await rebuildHotkeys()
      pushPttState(r)
    },
    setPttBinding: async (b: PttBinding) => {
      settings.patch({ pttKeyCode: b.key.code, pttKeyName: b.key.name, pttModifier: b.modifier ?? '' })
      setState({ ptt: { ...state.ptt, keyName: bindingLabel(b), keyCode: b.key.code, modifier: b.modifier } })
      const r = await rebuildHotkeys()
      pushPttState(r)
    },
    capturePttKey: async (): Promise<PttCaptureResult> => {
      if (!(await evdevBackend.available())) return { reason: 'unavailable' }
      const wasEnabled = ptt.isEnabled()
      let result: PttCaptureResult = { reason: 'timeout' }
      // captureInFlight blocks any OTHER handler's rebuildHotkeys() from
      // reopening the session while the raw probe below is reading the same
      // devices — set before the close, cleared before the closing rebuild
      // so that rebuild is the one that actually runs.
      captureInFlight = true
      try {
        // Close the WHOLE shared session for the capture window, not just
        // PTT's local mute gate — the four action hotkeys stay bound
        // otherwise, so a key already bound to (say) record or goLive would
        // fire it while the user is only trying to press it for PTT capture.
        // The pressed key must also never transmit through PTT's own mute
        // gate, so disarm on top of the close. Both live inside this try so
        // the finally below is the real "session never stays closed"
        // guarantee, not just a comment.
        await hotkeys.close()
        if (wasEnabled) await ptt.disarm()
        result = await captureNextKey()
        if ('key' in result) {
          // Guard the PTT-against-actions leg findConflict doesn't cover: a
          // key already bound to record/goLive/masks/micMute must not also
          // become the PTT key, or both would fire on every press. Reject
          // and name the owner instead of silently binding over it.
          const owner = findActionOwner({ key: result.key, modifier: null }, bindingsNow())
          if (owner) {
            result = { reason: 'conflict', owner }
          } else {
            settings.patch({ pttKeyCode: result.key.code, pttKeyName: result.key.name, pttModifier: '' })
            setState({ ptt: { ...state.ptt, keyName: bindingLabel({ key: result.key, modifier: null }), keyCode: result.key.code, modifier: null } })
          }
        }
      } finally {
        // Rebuild unconditionally, even if the close, the capture, or the
        // settings patch above threw, was cancelled, or timed out, and
        // regardless of whether PTT itself was enabled (the other four
        // hotkeys still need to come back).
        captureInFlight = false
        const r = await rebuildHotkeys()
        pushPttState(r)
      }
      return result
    },
    unlockPassthrough: async () => {
      const r = await runInputUnlock(execAsync)
      if (r.ok && ptt.isEnabled()) {
        // upgrade in place: rebuilding on the newly-unlocked evdev backend
        // releases F18 back to Discord's own passthrough read.
        const rr = await rebuildHotkeys()
        pushPttState(rr)
      }
      return r
    },
    recordAudioTest: async () => {
      // OBS has one record output — a VOD recording and this test cannot coexist.
      // recordingStartInFlight covers the window between StartRecord being
      // requested and state.recording.active flipping true.
      if (stream.isLive() || state.phase === 'GOING_LIVE' || !state.capture || state.recording.active || recordingStartInFlight) {
        return { ok: false, error: 'not available right now' }
      }
      setState({ audioTestActive: true })
      try {
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
      } finally {
        setState({ audioTestActive: false })
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
    dismissWelcome: async () => {
      settings.patch({ onboardedVersion: app.getVersion() })
      setState({ showWelcome: false })
    },
    // Copy via the main-process clipboard module: navigator.clipboard in the
    // renderer fails silently in Electron (denied by our permission handler,
    // and unavailable without a secure context / transient activation).
    copyToClipboard: async (text) => {
      try { clipboard.writeText(text); return true }
      catch (e) { console.warn('[clipboard] writeText failed', e); return false }
    },
    openExternalUrl: async (url: string) => openWebUrl(url),
    // Argument-free by design, so it also works from a partly-collapsed renderer.
    exportDiagnostics: async () => {
      const r = await collectDiagnostics({
        outDir: join(userData, 'diagnostics'),
        logDir: app.getPath('logs'),
        obsConfigRoot: runtime.configRoot,
        client: () => sidecar.client(),
        state: () => state,
        versions: {
          app: app.getVersion(),
          electron: process.versions.electron,
          node: process.versions.node,
          os: `${process.platform} ${release()}`,
        },
      })
      toast(win, r.ok
        ? { kind: 'success', message: 'Diagnostics exported', detail: r.path }
        : { kind: 'error', message: 'Diagnostics export failed', detail: r.error })
      return r
    },
    startRecording: async () => {
      const rejection = recordStartRejection({
        startInFlight: recordingStartInFlight,
        recordingActive: state.recording.active,
        audioTestActive: state.audioTestActive,
      })
      if (rejection) {
        // A rejection the user cannot see is a button that does nothing. The
        // in-flight case is deliberately silent: it is the second half of one
        // double-click, and the first half is already starting.
        if (rejection !== 'already starting') {
          toast(win, {
            kind: 'error',
            message: 'Cannot start recording',
            detail: rejection === 'an audio test is running'
              ? 'An audio test is using the recorder — it finishes in a few seconds.'
              : 'A recording is already running.',
          })
        }
        return { ok: false, error: rejection }
      }
      const dir = resolveRecordDir()
      const v = validateRecordDir(dir, app.getPath('home'))
      if (!v.ok) {
        setState({ recording: { ...state.recording, error: v.error ?? RECORD_DIR_ERROR } })
        toast(win, { kind: 'error', message: 'Recording folder is not usable', detail: v.error })
        return { ok: false, error: v.error }
      }
      recordingStartInFlight = true
      try {
        await fsPromises.mkdir(dir, { recursive: true }).catch(() => {})
        const r = await recorder.startRecording(dir, 'fragmented_mp4')
        if (!r.ok) {
          // Only clear the fields this call owns. If a recording is somehow
          // already running, reporting our own failure must not flip it to
          // inactive — that would leave OBS writing a file with no Stop button.
          setState({ recording: state.recording.active
            ? { ...state.recording, error: r.error ?? 'failed' }
            : { ...state.recording, active: false, startedAt: null, error: r.error ?? 'failed' } })
          toast(win, { kind: 'error', message: 'Recording failed to start', detail: r.error })
          return r
        }
        setState({ recording: { ...state.recording, active: true, startedAt: Date.now(), dir, error: null } })
        startRecordingHealthPoll()
        return r
      } finally {
        recordingStartInFlight = false
      }
    },

    stopRecording: async () => {
      if (!state.recording.active) return { ok: false, error: 'not recording' }
      stopRecordingHealthPoll()
      const r = await recorder.stopRecording()
      if (!r.ok) {
        setState({ recording: { ...state.recording, active: false, startedAt: null, error: r.error ?? 'failed' } })
        toast(win, { kind: 'error', message: 'Recording did not stop cleanly', detail: r.error })
        return r
      }
      sessionRecordingPath = r.outputPath ?? null
      setState({ recording: { ...state.recording, active: false, startedAt: null, lastPath: r.outputPath ?? null, error: null } })
      // If the summary is on screen, refresh it in place so "Still recording"
      // becomes "Open recording" without dismissing the panel.
      if (state.phase === 'ENDED' && state.summary) {
        setState({ summary: { ...state.summary, recordingStillActive: false, recordingPath: r.outputPath ?? null } })
      }
      return r
    },

    chooseRecordDir: async () => {
      const home = app.getPath('home')
      const res = await dialog.showOpenDialog({
        title: 'Choose where recordings are saved',
        defaultPath: resolveRecordDir(),
        properties: ['openDirectory', 'createDirectory'],
      })
      if (res.canceled || !res.filePaths[0]) return { ok: false }
      const dir = res.filePaths[0]
      const v = validateRecordDir(dir, home)
      if (!v.ok) return { ok: false, error: v.error }
      try {
        await fsPromises.mkdir(dir, { recursive: true })
        await fsPromises.access(dir, fsConstants.W_OK)
      } catch {
        return { ok: false, error: 'that folder is not writable' }
      }
      settings.patch({ recordDir: dir })
      setState({ recording: { ...state.recording, dir, error: null }, settings: viewOf(settings.load()) })
      return { ok: true, dir }
    },

    // Reveal (never open) — the diagnostics bundle is a zip we want the user to
    // attach to a report, not something an archive manager should unpack for them.
    revealFile: async (path: string) => {
      try {
        await fsPromises.access(path, fsConstants.R_OK)
      } catch {
        toast(win, { kind: 'error', message: 'File not found', detail: `${path} is no longer on disk.` })
        return { ok: false, error: 'that file is no longer on disk' }
      }
      try {
        shell.showItemInFolder(path)
        return { ok: true }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        toast(win, { kind: 'error', message: 'Could not open the folder', detail: error })
        return { ok: false, error }
      }
    },

    openRecording: async (path: string) => {
      // A recording the user moved or deleted takes the reveal path below,
      // where showItemInFolder silently no-ops — so without this check the
      // click reports success and nothing happens on screen.
      try {
        await fsPromises.access(path, fsConstants.R_OK)
      } catch {
        toast(win, { kind: 'error', message: 'Recording not found', detail: `${path} is no longer on disk.` })
        return { ok: false, error: 'that recording is no longer on disk' }
      }
      // openPath launches the system video player; on a machine with none
      // installed it returns a non-empty error string rather than throwing.
      const err = await shell.openPath(path)
      if (!err) return { ok: true }
      console.warn('[record] openPath failed, revealing instead:', err)
      try {
        shell.showItemInFolder(path)
        return { ok: true }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        toast(win, { kind: 'error', message: 'Could not open the recording', detail: error })
        return { ok: false, error }
      }
    },

    dismissSummary: async () => { setState({ phase: goReadyPhase(), summary: null }) },

    setWebcam: async (p: Partial<WebcamConfig>) => {
      const next = sanitizeWebcam({ ...settings.load().webcam, ...p })
      settings.patch({ webcam: next })
      await applyWebcam()
    },
    getWebcamDevices: () => webcamCtl.devices(),
    getWebcamProps: () => webcamCtl.props(),

    setQuality: async (p: QualityPatch) => {
      settings.patch(qualityPatchOf(p))
      // Read back rather than trusting the patch: load() is where clamping
      // and off-list rejection happen, so this is the value that will be used.
      const next = settings.load()
      setState({ quality: qualityViewOf(next) })
      if ('preferSoftware' in p) encoderKind = detectKind()
      // Applying now keeps the preview and the stat chips truthful. Safe
      // because only the output scale moves — base stays the monitor's native
      // size, so masks and the webcam do not shift. Deferred once OBS is
      // streaming — which starts at GOING_LIVE, not at LIVE — so an edit made
      // mid-transition lands at the next go-live instead of hitting a live OBS.
      // isStreamingPhase is shared with the renderer's Quality panel so the
      // two can never disagree about what counts as live.
      if (!isStreamingPhase(state.phase) && state.capture) {
        const capture_ = await applyResolutionLive('setQuality')
        await applyEncoderPreset(capture_.outputHeight, capture_.fps)
        setState({ capture: capture_ })
      }
    },
    setHotkey: async (id, binding) => {
      if (binding) {
        const conflict = findConflict(id, binding, bindingsNow(), settings.load().pttEnabled ? loadBinding() : null)
        if (conflict) return { ok: false, conflict }
      }
      const next = { ...settings.load().hotkeys, [id]: toPersisted(binding) }
      settings.patch({ hotkeys: next })
      setState({ hotkeys: { ...state.hotkeys, bindings: { ...state.hotkeys.bindings, [id]: binding } } })
      const r = await rebuildHotkeys()
      pushPttState(r)
      return { ok: true }
    },
  }
  registerIpc({ ipcMain, handlers, bindPush: () => {} })

  // Smoke mode: a fresh install boots to SETTING_UP and waits for the user
  // to start capture setup — drive it like the user would, once. On Windows
  // provisioning needs no portal approval, so this carries the boot all the
  // way to READY/NEEDS_YOUTUBE (the smoke success states).
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

  // Quit-time recording finalization. Reached only from the close handler
  // below, and only once it has decided the app is going: the memo inside is
  // for a second close landing during the deferral, and must never be able to
  // outlive a quit the user cancelled.
  const finalizeRecording = createRecordingFinalizer({
    stopHealthPoll: stopRecordingHealthPoll,
    stopRecording: () => recorder.stopRecording(),
  })

  // Wire quit-while-live guard and engine teardown before booting OBS,
  // so that close events fired during the async start are handled correctly.
  // Answered once: finalizing a recording defers the close and fires this
  // handler a second time, which must not re-ask.
  let closeConfirmed = false
  const teardownSidecar = createSidecarTeardown({ stopSidecar: () => sidecar.stop() })
  let teardownStarted = false
  win.on('close', (e) => {
    const live = stream.isLive()
    if (!closeConfirmed && (live || state.recording.active)) {
      const [message, quitLabel] = live && state.recording.active
        ? ["You're still live and still recording — end both and quit?", 'End stream, stop recording & quit']
        : live
        ? ["You're still live — end stream and quit?", 'End stream & quit']
        : ["You're still recording — stop the recording and quit?", 'Stop recording & quit']
      const choice = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Stay in AxiStream', quitLabel], defaultId: 0, cancelId: 0, message })
      if (choice === 0) { e.preventDefault(); return }
    }
    closeConfirmed = true
    // Finalize the recording BEFORE the sidecar teardown below: OBS must get
    // its StopRecord and write the file's index while it is still alive.
    // Every quit path — the window's X, tray Quit, app.quit() — reaches this
    // handler, so this is the only place that stops a recording on the way
    // out. Defer the close, then re-close once OBS has finished the file —
    // boxed at 2s so quitting can never hang on OBS.
    if (state.recording.active) {
      e.preventDefault()
      void finalizeRecording().finally(() => {
        // Cleared unconditionally: the second close must not defer again, even
        // if StopRecord timed out, and the UI must not keep timing a recording
        // that OBS has already stopped.
        setState({ recording: { ...state.recording, active: false, startedAt: null } })
        // Two closes arriving during the deferral both wait on the one
        // finalization and then run back to back; the first destroys the
        // window, so the second must not call close() on it — that throws
        // "Object has been destroyed" into the quit path.
        if (!win.isDestroyed()) win.close()
      })
      return
    }
    // The re-close below lands here again; let that one through to destroy
    // the window instead of tearing everything down a second time.
    if (teardownStarted) return
    teardownStarted = true
    preview.stop()
    void meter.stop()
    try { void sidecar.client().call('StopVirtualCam').catch(() => {}) } catch { /* ignore */ }
    if (ptt.isEnabled()) void ptt.restore()
    // Defer the close until OBS is actually gone, the same way the recording
    // finalizer above does. Destroying the window here reaches
    // window-all-closed -> app.quit(), which kills us mid-teardown and leaves
    // OBS (and the cage compositor hosting it) running with nothing left to
    // close it. teardownSidecar boxes the wait, so a hung OBS still lets us
    // quit.
    e.preventDefault()
    void teardownSidecar().finally(() => { if (!win.isDestroyed()) win.close() })
  })

  // No before-quit arm: it fires on quits the close handler then cancels
  // ("Stay in AxiStream"), which would leave the app running with the
  // recording already stopped in OBS and the finalization memo spent — the
  // NEXT recording would then be torn down with no StopRecord at all.
  // app.quit() closes the windows, so the close handler covers those paths.

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
    await capture.start()
    if (runtimeOnlySmokeMode) {
      smokeWatcher?.succeed(`SMOKE OK owned runtime platform=${process.platform}`)
      return
    }
    // Move onto an AxiStream-owned profile with no external YouTube auth — a
    // profile carrying that auth makes OBS route go-live through its broadcast
    // flow, which silently no-ops headless and never pushes RTMP. Persists across
    // restarts, so it's a one-time switch in practice. Best-effort.
    await ensureCleanProfile({ call: (r, p) => sidecar.client().call(r as never, p as never) })
    // Crash recovery (a previous run may have died source-muted) and the
    // portal/evdev availability probe run regardless of provisioning: the
    // mic-hot invariant does not get to wait on capture setup, and an
    // unprovisioned boot with pttEnabled=true must not baseline-mute via the
    // boot rebuildHotkeys() below without this unmute running first.
    await ptt.restore()
    const pttAvailable = await ptt.available()
    const lbInit = loadBinding(); setState({ ptt: { ...state.ptt, available: pttAvailable, keyName: bindingLabel(lbInit), keyCode: lbInit.key.code, modifier: lbInit.modifier } })
    // Derived on every boot path, above the provisioned split: a fresh install
    // is unprovisioned, and deriving this only in the provisioned branch left
    // showWelcome at its `false` default for the one user it exists for.
    setState({ showWelcome: shouldShowWelcome(settings.load().onboardedVersion) })
    const provisioned = config.load().provisioned
    if (provisioned) {
      const capture_ = await applyResolution()
      await applyEncoderPreset(capture_.outputHeight, capture_.fps)
      setState({ phase: goReadyPhase(), capture: capture_ })
      startVirtualCam()
      // Self-heal audio inputs on every boot — installs provisioned before the
      // audio feature never ran buildCollection again, so the inputs would be
      // missing. ensureAudioInputs is idempotent and best-effort.
      await ensureAudioInputs(sidecar.client())
      const a = settings.load()
      setState({ audio: { desktopEnabled: a.desktopEnabled, desktopDevice: a.desktopDevice, micEnabled: a.micEnabled, micDevice: a.micDevice, gameAudioApps: a.gameAudioApps } })
      await audio.applySettings({ desktopEnabled: a.desktopEnabled, desktopDevice: a.desktopDevice, micEnabled: a.micEnabled, micDevice: a.micDevice })
      // PTT: install the desktop entry the portal Registry validates our host
      // app id against. Crash recovery and the availability probe already
      // ran above, unconditionally.
      if (process.platform === 'linux') await ensureDesktopEntry(process.execPath, homedir(), {
        mkdir: (p) => fsPromises.mkdir(p, { recursive: true }),
        readFile: (p) => fsPromises.readFile(p, 'utf8'),
        writeFile: (p, c) => fsPromises.writeFile(p, c),
      })
      setState({ masks: a.masks, masksVisible: a.masksVisible, webcam: { ...a.webcam, available: true }, quality: qualityViewOf(a) })
      pushFitted()
      await applyMasksRespectingVisibility()
      // On a fresh install capture.start() only starts the sidecar — scene
      // 'Main' may not exist yet until provisioning runs. WebcamController.apply
      // throws internally in that case, is swallowed (best-effort), and
      // `available` is left at its seeded `true` — correct, but only by
      // accident of that swallow, not because the camera was verified.
      await applyWebcam()
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
    // Nothing here may block boot: bindings live in settings.json regardless
    // of capture state, so this fires once boot has otherwise settled and
    // reports into state.hotkeys/state.ptt whenever it resolves. .catch is
    // required, not decorative — an uncaught throw here is an unhandled
    // rejection on the boot path with no request context to report it.
    void rebuildHotkeys().then((r) => pushPttState(r)).catch((e) => console.warn('[hotkeys] boot rebuild failed', e instanceof Error ? e.message : e))
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error('[boot] stream engine failed:', detail)
    setState({ phase: 'ERROR', error: `Could not start the stream engine (OBS): ${detail}` })
  }
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
