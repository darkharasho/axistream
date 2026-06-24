import { AppState, LiveStats, INITIAL_STATE } from '../shared/state.js'

export function createStore() {
  let state: AppState = { ...INITIAL_STATE }
  let preview: string | null = null
  const subs = new Set<() => void>()
  const notify = () => subs.forEach((f) => f())
  return {
    getState: () => state,
    getPreview: () => preview,
    subscribe(fn: () => void) { subs.add(fn); return () => subs.delete(fn) },
    applyState(partial: Partial<AppState>) { state = { ...state, ...partial }; notify() },
    applyStats(s: LiveStats) { state = { ...state, stats: s }; notify() },
    applyPreview(dataUrl: string) { preview = dataUrl; notify() },
  }
}
export type Store = ReturnType<typeof createStore>
