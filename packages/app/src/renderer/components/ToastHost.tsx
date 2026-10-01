import { useSyncExternalStore } from 'react'
import { Info, CheckCircle2, AlertCircle, X } from 'lucide-react'
import { toastStore, type ToastStore } from '../toasts.js'

const ICONS = { info: Info, success: CheckCircle2, error: AlertCircle }

export function ToastHost({ store = toastStore }: { store?: ToastStore }) {
  const toasts = useSyncExternalStore(store.subscribe, store.getToasts)
  if (!toasts.length) return null
  return (
    <div className="axi-toasts">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind]
        return (
          // The language's .axi-toast--ok/--danger modifiers colour an
          // .axi-toast__dot and nothing else; this host renders a lucide icon
          // instead of a dot, so they would be dead weight. The status is
          // carried by .axi-toast.{kind} in styles.css.
          <div key={t.id} className={`axi-toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <Icon size={15} className="toast-icon" />
            <div className="toast-body">
              <span className="toast-msg">{t.message}</span>
              {t.detail ? <span className="toast-detail">{t.detail}</span> : null}
            </div>
            <button className="toast-x" aria-label="Dismiss notification" onClick={() => store.dismiss(t.id)}>
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
