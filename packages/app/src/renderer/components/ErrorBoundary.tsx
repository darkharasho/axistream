import { Component, type ErrorInfo, type ReactNode } from 'react'
import { store } from '../store.js'
import type { AxiApi } from '../../shared/state.js'

const axi = () => (globalThis as unknown as { axi: AxiApi }).axi

interface Props {
  /** Human name of the region this guards — shown in the fallback. */
  label: string
  /** Root boundaries reload the window; screen boundaries reset their subtree. */
  root?: boolean
  children: ReactNode
}
interface State { error: Error | null; stack: string }

/**
 * Catches renderer render errors.
 *
 * The framing matters: main owns OBS, so a renderer crash does NOT stop the
 * stream. The user is very likely still broadcasting and has simply lost
 * visibility, so the fallback leads with that and never offers a restart —
 * restarting is the one action most likely to actually cost them a broadcast.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ stack: info.componentStack ?? '' })
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info.componentStack)
  }

  private reset = (): void => {
    // Main is untouched either way; App's mount effect re-syncs through
    // getInitialState once the subtree remounts.
    if (this.props.root) { window.location.reload(); return }
    this.setState({ error: null, stack: '' })
  }

  private copy = async (): Promise<void> => {
    const version = await axi().appVersion().catch(() => 'unknown')
    const body = [
      `AxiStream ${version}`,
      `${this.props.label}: ${this.state.error?.message ?? 'unknown error'}`,
      this.state.stack,
    ].join('\n')
    // Main-process clipboard, not navigator.clipboard (see PR #12).
    await axi().copyToClipboard(body).catch(() => false)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    const phase = store.getState().phase
    const live = phase === 'LIVE' || phase === 'RECONNECTING'
    return (
      <div className="hero crash" role="alert">
        <h2>Something broke in {this.props.label}.</h2>
        {live ? <p className="crash-live">Your stream is still running.</p> : null}
        <p className="crash-msg">{error.message}</p>
        <div className="crash-actions">
          <button className="btn primary" onClick={this.reset}>Reload</button>
          <button className="btn ghost" onClick={() => void this.copy()}>Copy error details</button>
        </div>
      </div>
    )
  }
}
