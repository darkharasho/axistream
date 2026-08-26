import { useEffect, useState, useSyncExternalStore } from 'react'
import { Minus, Square, X } from 'lucide-react'
import { store } from './store.js'
import { Sidebar } from './components/Sidebar.js'
import { StreamScreen } from './components/StreamScreen.js'
import { SettingsScreen } from './components/SettingsScreen.js'
import { ToastHost } from './components/ToastHost.js'
import { ErrorBoundary } from './components/ErrorBoundary.js'
import { WelcomeBanner } from './components/WelcomeBanner.js'
import { WelcomeWizard } from './components/WelcomeWizard.js'
import { toastStore } from './toasts.js'
import type { AxiApi, UpdateStatus } from '../shared/state.js'

const axi = (globalThis as unknown as { axi: AxiApi }).axi

export function App() {
  const [nav, setNav] = useState<'stream' | 'settings'>('stream')
  const [wizard, setWizard] = useState(false)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const preview = useSyncExternalStore(store.subscribe, store.getPreview)

  useEffect(() => { if (state.phase === 'AWAITING_APPROVAL') setNav('stream') }, [state.phase])

  useEffect(() => {
    const offs = [
      axi.onState((p) => store.applyState(p)),
      axi.onStats((s) => store.applyStats(s)),
      axi.onPreview((d) => store.applyPreview(d)),
      axi.onUpdateStatus((s) => {
        setUpdate(s)
        // Update failures otherwise render only inside UpdatesSettings — invisible
        // unless the user happens to be sitting on the Settings screen.
        if (s.state === 'error') toastStore.push({ kind: 'error', message: 'Update failed', detail: s.message })
      }),
      axi.onToast((t) => { toastStore.push(t) }),
    ]
    axi.getInitialState().then((s) => store.applyState(s))
    return () => offs.forEach((off) => off())
  }, [])

  return (
    <ErrorBoundary label="AxiStream" root>
      <div className="app">
        <div className="dragbar" />
        <ToastHost />
        {state.showWelcome && nav === 'stream'
          ? <WelcomeBanner onSetUp={() => setWizard(true)} onDismiss={() => axi.dismissWelcome()} />
          : null}
        {wizard
          ? <WelcomeWizard state={state} axi={axi} onClose={() => { setWizard(false); void axi.dismissWelcome() }} />
          : null}
        <Sidebar active={nav} state={state} onNav={setNav} axi={axi} update={update} />
        {nav === 'stream'
          ? <ErrorBoundary label="Stream"><StreamScreen state={state} preview={preview} axi={axi} store={store} /></ErrorBoundary>
          : <ErrorBoundary label="Settings"><SettingsScreen state={state} axi={axi} onRunSetup={() => setWizard(true)} /></ErrorBoundary>}
        <div className="wctl">
          <button className="wbtn" aria-label="Minimize" onClick={() => axi.windowMinimize()}><Minus size={15} /></button>
          <button className="wbtn" aria-label="Maximize" onClick={() => axi.windowToggleMaximize()}><Square size={13} /></button>
          <button className="wbtn close" aria-label="Close" onClick={() => axi.windowClose()}><X size={15} /></button>
        </div>
      </div>
    </ErrorBoundary>
  )
}
