export type StreamPhase =
  | 'SETTING_UP' | 'AWAITING_APPROVAL' | 'NEEDS_KEY' | 'READY'
  | 'GOING_LIVE' | 'LIVE' | 'RECONNECTING' | 'ERROR'

export interface CaptureMeta { sourceLabel: string; width: number; height: number; outputWidth: number; outputHeight: number; fps: number }
export interface LiveStats {
  bitrateKbps: number; droppedFrames: number; durationMs: number;
  encoder: string; cpuPct: number; reconnecting: boolean
}
export interface AppState {
  phase: StreamPhase
  capture: CaptureMeta | null
  keyMasked: string | null
  stats: LiveStats | null
  error: string | null
}
export const INITIAL_STATE: AppState = {
  phase: 'SETTING_UP', capture: null, keyMasked: null, stats: null, error: null,
}

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
} as const

export interface AxiApi {
  getInitialState(): Promise<AppState>
  provision(): Promise<void>
  saveKey(key: string): Promise<void>
  forgetKey(): Promise<void>
  goLive(): Promise<void>
  stopStream(): Promise<void>
  repairCapture(): Promise<void>
  switchSource(): Promise<void>
  windowMinimize(): Promise<void>
  windowToggleMaximize(): Promise<void>
  windowClose(): Promise<void>
  onState(cb: (s: Partial<AppState>) => void): () => void
  onStats(cb: (s: LiveStats) => void): () => void
  onPreview(cb: (dataUrl: string) => void): () => void
}
