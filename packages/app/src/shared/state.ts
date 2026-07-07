export type StreamPhase =
  | 'SETTING_UP' | 'AWAITING_APPROVAL' | 'NEEDS_KEY' | 'NEEDS_TITLE' | 'READY'
  | 'GOING_LIVE' | 'LIVE' | 'RECONNECTING' | 'ERROR'

export type GameAudioPluginStatus = 'missing' | 'installing' | 'installed' | 'ready' | 'error' | 'unsupported'

export interface MaskRect { id: string; x: number; y: number; w: number; h: number }
export const MAX_MASKS = 8
export interface GameAudioPluginView { status: GameAudioPluginStatus; error: string | null }

export interface StreamSettingsView {
  titleTemplate: string
  dateFormat: string
  privacy: 'public' | 'unlisted' | 'private'
  discordWebhookUrl: string
  discordMessage: string
}

export interface AudioDevice { id: string; name: string }
export interface CaptureMeta { sourceLabel: string; width: number; height: number; outputWidth: number; outputHeight: number; fps: number }
export interface LiveStats {
  bitrateKbps: number; droppedFrames: number; droppedPct: number; durationMs: number;
  encoder: string; cpuPct: number; reconnecting: boolean
}
export interface AppState {
  phase: StreamPhase
  capture: CaptureMeta | null
  keyMasked: string | null
  stats: LiveStats | null
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
  ptt: { available: boolean; enabled: boolean; active: boolean; error: string | null }
  windowFitted: boolean
  masksVisible: boolean
}
export const INITIAL_STATE: AppState = {
  phase: 'SETTING_UP', capture: null, keyMasked: null, stats: null, error: null,
  encoder: 'x264', videoBitrateKbps: null,
  youtube: { connected: false, channel: null },
  settings: { titleTemplate: '', dateFormat: 'YYYY-MM-DD', privacy: 'public', discordWebhookUrl: '', discordMessage: '' },
  audio: { desktopEnabled: true, desktopDevice: null, micEnabled: false, micDevice: null, gameAudioApps: [] },
  masks: [],
  gameAudioPlugin: { status: 'missing', error: null },
  blurPlugin: { status: 'missing', error: null },
  maskStyle: 'box',
  ptt: { available: false, enabled: false, active: false, error: null },
  windowFitted: false,
  masksVisible: true,
}

export interface AudioLevels { desktop: number; mic: number; game: number }

export interface DiscordTestResult { ok: boolean; error?: string }

export interface AudioTestResult { ok: boolean; clip?: Uint8Array; mime?: string; error?: string }

export const CH = {
  getInitialState: 'axi:getInitialState',
  provision: 'axi:provision',
  saveKey: 'axi:saveKey',
  forgetKey: 'axi:forgetKey',
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
  setMasksVisible: 'axi:setMasksVisible',
} as const

export interface AxiApi {
  getInitialState(): Promise<AppState>
  provision(): Promise<void>
  saveKey(key: string): Promise<void>
  forgetKey(): Promise<void>
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
  setMasksVisible(visible: boolean): Promise<void>
  onState(cb: (s: Partial<AppState>) => void): () => void
  onStats(cb: (s: LiveStats) => void): () => void
  onPreview(cb: (dataUrl: string) => void): () => void
  onCaptureChanged(cb: () => void): () => void
  onAudioLevels(cb: (l: AudioLevels) => void): () => void
}
