import { useEffect, useState, useSyncExternalStore } from 'react'
import { createStore } from './store.js'
import { Sidebar } from './components/Sidebar.js'
import { StreamScreen } from './components/StreamScreen.js'
import { SettingsScreen } from './components/SettingsScreen.js'
import type { AxiApi } from '../shared/state.js'

const store = createStore()
const axi = (globalThis as unknown as { axi: AxiApi }).axi

export function App() {
  const [nav, setNav] = useState<'stream' | 'settings'>('stream')
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const preview = useSyncExternalStore(store.subscribe, store.getPreview)

  useEffect(() => { if (state.phase === 'AWAITING_APPROVAL') setNav('stream') }, [state.phase])

  useEffect(() => {
    const offs = [
      axi.onState((p) => store.applyState(p)),
      axi.onStats((s) => store.applyStats(s)),
      axi.onPreview((d) => store.applyPreview(d)),
    ]
    axi.getInitialState().then((s) => store.applyState(s))
    return () => offs.forEach((off) => off())
  }, [])

  return (
    <div className="app">
      <Sidebar active={nav} phase={state.phase} onNav={setNav} />
      {nav === 'stream'
        ? <StreamScreen state={state} preview={preview} axi={axi} />
        : <SettingsScreen state={state} axi={axi} />}
      <div className="wctl">
        <button className="wbtn" aria-label="Minimize" onClick={() => axi.windowMinimize()}>—</button>
        <button className="wbtn" aria-label="Maximize" onClick={() => axi.windowToggleMaximize()}>▢</button>
        <button className="wbtn close" aria-label="Close" onClick={() => axi.windowClose()}>✕</button>
      </div>
    </div>
  )
}
