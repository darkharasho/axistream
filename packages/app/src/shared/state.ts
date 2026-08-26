import type { PttBinding, PttCaptureResult } from './keys.js'

export type StreamPhase =
  | 'SETTING_UP' | 'PREPARING_CAPTURE' | 'CHOOSING_CAPTURE' | 'AWAITING_APPROVAL'
  | 'NEEDS_YOUTUBE' | 'NEEDS_TITLE' | 'READY'
  | 'GOING_LIVE' | 'STARTING_ON_YOUTUBE' | 'LIVE' | 'RECONNECTING' | 'ENDED' | 'ERROR'

/** True from the moment OBS starts streaming (GOING_LIVE) through to the
 *  moment it stops (LIVE/RECONNECTING). A quality edit made in any of these
 *  phases must defer to the next stream rather than touch a live OBS — used
 *  both by main (to decide whether to apply now or defer) and by the Quality
 *  panel (to decide whether to show the "Applies to your next stream" note),
 *  so the two can never disagree about what counts as live. */
export function isStreamingPhase(phase: StreamPhase): boolean {
  return phase === 'GOING_LIVE' || phase === 'STARTING_ON_YOUTUBE' || phase === 'LIVE' || phase === 'RECONNECTING'
}

export type GameAudioPluginStatus = 'missing' | 'installing' | 'installed' | 'ready' | 'error' | 'unsupported'

export interface MaskRect { id: string; x: number; y: number; w: number; h: number }
export const MAX_MASKS = 8

export type WebcamCorner = 'tl' | 'tr' | 'bl' | 'br'
export const WEBCAM_MIN_SIZE_PCT = 0.15
export const WEBCAM_MAX_SIZE_PCT = 0.35

export const QUALITY_HEIGHTS = [720, 1080, 1440]
export const QUALITY_FPS = [30, 60]
export const MIN_BITRATE_KBPS = 1000
export const MAX_BITRATE_KBPS = 51000
/** What Auto resolves to. The cap matches applyCaptureResolution's own
 *  default, so "Auto" and "no override" are the same stream. Shared because
 *  main resolves with them and the renderer labels the Auto option with them —
 *  two copies would be two places to get out of sync. */
export const AUTO_MAX_HEIGHT = 1440
export const AUTO_FPS = 60

// All three OBS v4l2 properties, set together. Picking a resolution without
// its pixel format is what produces the 5fps YUYV case this override escapes.
export interface WebcamMode { pixelformat: string; resolution: string; framerate: string }
export interface WebcamOption { value: string; label: string }
export interface WebcamProps {
  pixelformats: WebcamOption[]
  resolutions: WebcamOption[]
  framerates: WebcamOption[]
}

export interface WebcamConfig {
  enabled: boolean
  deviceId: string | null
  deviceLabel: string | null
  corner: WebcamCorner
  sizePct: number
  mirrored: boolean
  mode: WebcamMode | null
}

export interface WebcamView extends WebcamConfig {
  /** Condition, not an event: drives a chip. Never persisted. */
  available: boolean
}

export const DEFAULT_WEBCAM: WebcamConfig = {
  enabled: false,
  deviceId: null,
  deviceLabel: null,
  corner: 'br',
  sizePct: 0.22,
  mirrored: false,
  mode: null,
}

export interface QualityView {
  height: number | null
  fps: number | null
  bitrateKbps: number | null
  preferSoftware: boolean
  preferSoftwareAuto: boolean
}

/** A partial edit from the renderer. Keys map to the `quality*` settings
 *  fields; `null` means "back to Auto". */
export interface QualityPatch {
  height?: number | null
  fps?: number | null
  bitrateKbps?: number | null
  preferSoftware?: boolean
}

export const DEFAULT_QUALITY: QualityView = {
  height: null, fps: null, bitrateKbps: null, preferSoftware: false, preferSoftwareAuto: false,
}

export interface GameAudioPluginView { status: GameAudioPluginStatus; error: string | null }

export interface StreamSettingsView {
  titleTemplate: string
  dateFormat: string
  privacy: 'public' | 'unlisted' | 'private'
  discordWebhookUrl: string
  discordMessage: string
  recordDir: string
}

export interface AudioDevice { id: string; name: string }
export interface CaptureTargetOption { property: string; value: string | number; label: string }
export interface CaptureMeta { sourceLabel: string; width: number; height: number; outputWidth: number; outputHeight: number; fps: number }
export interface LiveStats {
  bitrateKbps: number; droppedFrames: number; droppedPct: number; durationMs: number;
  encoder: string; cpuPct: number; reconnecting: boolean
}

/** Local recording. A condition, so it lives here rather than on the toast channel. */
export interface RecordingState {
  active: boolean
  /** Epoch ms. The renderer derives elapsed time from this rather than main
   *  pushing a per-second counter down a second stats channel. */
  startedAt: number | null
  dir: string
  /** Most recent finished recording, for the summary's "Open recording". */
  lastPath: string | null
  error: string | null
}

/** Snapshot taken at End Stream. OBS's stats are instantaneous and vanish once
 *  the stream stops, so every figure here is accumulated live — nothing in this
 *  shape can be recomputed after the fact. */
export interface StreamSummary {
  durationMs: number
  avgBitrateKbps: number
  peakDroppedPct: number
  droppedFrames: number
  droppedPct: number
  encoder: string
  watchUrl: string | null
  /** A recording that finished during this stream. */
  recordingPath: string | null
  /** A recording still running when the stream ended — the normal case, since
   *  Record is fully manual and End Stream does not stop it. */
  recordingStillActive: boolean
  endedWithError: boolean
}

export interface AppState {
  phase: StreamPhase
  capture: CaptureMeta | null
  captureTargets: CaptureTargetOption[]
  stats: LiveStats | null
  liveUnconfirmed: boolean
  error: string | null
  encoder: string
  videoBitrateKbps: number | null
  youtube: { connected: boolean; channel: string | null }
  settings: StreamSettingsView
  audio: { desktopEnabled: boolean; desktopDevice: string | null; micEnabled: boolean; micDevice: string | null; gameAudioApps: string[] }
  masks: MaskRect[]
  gameAudioPlugin: GameAudioPluginView
  blurPlugin: GameAudioPluginView
  maskStyle: 'box' | 'blur'
  ptt: { available: boolean; enabled: boolean; active: boolean; error: string | null; mode: 'passthrough' | 'exclusive' | null; keyName: string; keyCode: number; modifier: import('./keys.js').PttModifier | null }
  windowFitted: boolean
  masksVisible: boolean
  watchUrl: string | null
  webcam: WebcamView
  quality: QualityView
  recording: RecordingState
  /** The six-second audio test owns OBS's single record output while it runs,
   *  so Record must refuse. A condition, so it lives here rather than as a
   *  main-process local the renderer cannot see. */
  audioTestActive: boolean
  summary: StreamSummary | null
}
export const INITIAL_STATE: AppState = {
  phase: 'SETTING_UP', capture: null, captureTargets: [], stats: null, liveUnconfirmed: false, error: null,
  encoder: 'x264', videoBitrateKbps: null,
  youtube: { connected: false, channel: null },
  settings: { titleTemplate: '', dateFormat: 'YYYY-MM-DD', privacy: 'public', discordWebhookUrl: '', discordMessage: '', recordDir: '' },
  audio: { desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] },
  masks: [],
  gameAudioPlugin: { status: 'missing', error: null },
  blurPlugin: { status: 'missing', error: null },
  maskStyle: 'box',
  ptt: { available: false, enabled: false, active: false, error: null, mode: null, keyName: 'F18', keyCode: 188, modifier: null },
  windowFitted: false,
  masksVisible: true,
  watchUrl: null,
  webcam: { ...DEFAULT_WEBCAM, available: true },
  quality: { ...DEFAULT_QUALITY },
  recording: { active: false, startedAt: null, dir: '', lastPath: null, error: null },
  audioTestActive: false,
  summary: null,
}

export interface AudioLevels { desktop: number; mic: number; game: number }

export interface DiscordTestResult { ok: boolean; error?: string }

export interface DiagnosticsResult { ok: boolean; path?: string; error?: string }

export interface RecordStartResult { ok: boolean; error?: string }
export interface RecordStopResult { ok: boolean; outputPath?: string; error?: string }
export interface ChooseDirResult { ok: boolean; dir?: string; error?: string }
export interface OpenResult { ok: boolean; error?: string }

/** One-off notification. Discrete events only — conditions belong in AppState. */
export type ToastKind = 'info' | 'success' | 'error'
export interface ToastPayload {
  kind: ToastKind
  /** Human-readable, one line. */
  message: string
  /** Technical string (OBS error, HTTP status), rendered smaller beneath the message. */
  detail?: string
}
export interface Toast extends ToastPayload { id: string }

/** Update lifecycle pushed to the renderer for a non-intrusive banner. */
export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'none' }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

export interface AudioTestResult { ok: boolean; clip?: Uint8Array; mime?: string; error?: string }

export const CH = {
  getInitialState: 'axi:getInitialState',
  provision: 'axi:provision',
  getCaptureTargets: 'axi:getCaptureTargets',
  cancelCaptureSelection: 'axi:cancelCaptureSelection',
  goLive: 'axi:goLive',
  stopStream: 'axi:stopStream',
  repairCapture: 'axi:repairCapture',
  switchSource: 'axi:switchSource',
  windowMinimize: 'axi:win:minimize',
  windowToggleMaximize: 'axi:win:maximize',
  windowClose: 'axi:win:close',
  evtState: 'axi:evt:state',
  evtStats: 'axi:evt:stats',
  evtPreview: 'axi:evt:preview',
  evtCaptureChanged: 'axi:evt:captureChanged',
  connectYouTube: 'axi:connectYouTube',
  disconnectYouTube: 'axi:disconnectYouTube',
  getSettings: 'axi:getSettings',
  saveSettings: 'axi:saveSettings',
  previewTitle: 'axi:previewTitle',
  getAudioDevices: 'axi:getAudioDevices',
  setDesktopEnabled: 'axi:setDesktopEnabled',
  setMicEnabled: 'axi:setMicEnabled',
  setMicDevice: 'axi:setMicDevice',
  getDesktopDevices: 'axi:getDesktopDevices',
  setDesktopDevice: 'axi:setDesktopDevice',
  setMasks: 'axi:setMasks',
  getGameAudioPluginStatus: 'axi:getGameAudioPluginStatus',
  installGameAudioPlugin: 'axi:installGameAudioPlugin',
  setMaskStyle: 'axi:setMaskStyle',
  installBlurPlugin: 'axi:installBlurPlugin',
  relaunchApp: 'axi:relaunchApp',
  setGameAudioApps: 'axi:setGameAudioApps',
  getGameAudioApps: 'axi:getGameAudioApps',
  fitWindowToCapture: 'axi:fitWindowToCapture',
  evtAudioLevels: 'axi:evt:audioLevels',
  testDiscordWebhook: 'axi:testDiscordWebhook',
  recordAudioTest: 'axi:recordAudioTest',
  setPttEnabled: 'axi:setPttEnabled',
  setPttBinding: 'axi:setPttBinding',
  capturePttKey: 'axi:capturePttKey',
  unlockPassthrough: 'axi:unlockPassthrough',
  setMasksVisible: 'axi:setMasksVisible',
  updatesCheck: 'updates:check',
  updatesInstall: 'updates:install',
  evtUpdateStatus: 'updates:status',
  evtToast: 'axi:evt:toast',
  appVersion: 'app:version',
  getWhatsNew: 'app:getWhatsNew',
  setLastSeenVersion: 'app:setLastSeenVersion',
  copyToClipboard: 'app:copyToClipboard',
  openExternalUrl: 'app:openExternalUrl',
  exportDiagnostics: 'axi:exportDiagnostics',
  startRecording: 'axi:startRecording',
  stopRecording: 'axi:stopRecording',
  chooseRecordDir: 'axi:chooseRecordDir',
  openRecording: 'axi:openRecording',
  dismissSummary: 'axi:dismissSummary',
  setWebcam: 'axi:setWebcam',
  getWebcamDevices: 'axi:getWebcamDevices',
  getWebcamProps: 'axi:getWebcamProps',
  setQuality: 'axi:setQuality',
} as const

export interface AxiApi {
  getInitialState(): Promise<AppState>
  provision(target?: CaptureTargetOption): Promise<void>
  getCaptureTargets(): Promise<CaptureTargetOption[]>
  cancelCaptureSelection(): Promise<void>
  goLive(title?: string): Promise<void>
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
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
  appVersion(): Promise<string>
  getWhatsNew(): Promise<{ version: string; notes: string | null }>
  setLastSeenVersion(v: string): Promise<void>
  copyToClipboard(text: string): Promise<boolean>
  openExternalUrl(url: string): Promise<boolean>
  exportDiagnostics(): Promise<DiagnosticsResult>
  startRecording(): Promise<RecordStartResult>
  stopRecording(): Promise<RecordStopResult>
  chooseRecordDir(): Promise<ChooseDirResult>
  openRecording(path: string): Promise<OpenResult>
  dismissSummary(): Promise<void>
  setWebcam(p: Partial<WebcamConfig>): Promise<void>
  getWebcamDevices(): Promise<AudioDevice[]>
  getWebcamProps(): Promise<WebcamProps>
  setQuality(p: QualityPatch): Promise<void>
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void
  onToast(cb: (t: ToastPayload) => void): () => void
  onState(cb: (s: Partial<AppState>) => void): () => void
  onStats(cb: (s: LiveStats) => void): () => void
  onPreview(cb: (dataUrl: string) => void): () => void
  onCaptureChanged(cb: () => void): () => void
  onAudioLevels(cb: (l: AudioLevels) => void): () => void
}
