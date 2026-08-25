import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ErrorBoundary } from '../src/renderer/components/ErrorBoundary.js'
import { store } from '../src/renderer/store.js'

const Boom = ({ fail }: { fail: boolean }) => {
  if (fail) throw new Error('kaboom')
  return <div>all good</div>
}

let copyToClipboard: ReturnType<typeof vi.fn>
let appVersion: ReturnType<typeof vi.fn>

beforeEach(() => {
  copyToClipboard = vi.fn().mockResolvedValue(true)
  appVersion = vi.fn().mockResolvedValue('1.0.0')
  ;(globalThis as any).axi = { copyToClipboard, appVersion }
  // React logs caught errors; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  store.applyState({ phase: 'READY' })
})
afterEach(() => { vi.restoreAllMocks() })

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(<ErrorBoundary label="Stream"><Boom fail={false} /></ErrorBoundary>)
    expect(screen.getByText('all good')).toBeTruthy()
  })

  it('renders the fallback with the label when a child throws', () => {
    render(<ErrorBoundary label="Settings"><Boom fail={true} /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent(/Something broke in Settings/i)
  })

  it('reassures the user when live that the stream is still running', () => {
    store.applyState({ phase: 'LIVE' })
    render(<ErrorBoundary label="Settings"><Boom fail={true} /></ErrorBoundary>)
    expect(screen.getByText(/stream is still running/i)).toBeTruthy()
  })

  it('reassures the user while reconnecting too', () => {
    store.applyState({ phase: 'RECONNECTING' })
    render(<ErrorBoundary label="Settings"><Boom fail={true} /></ErrorBoundary>)
    expect(screen.getByText(/stream is still running/i)).toBeTruthy()
  })

  it('does not claim a stream is running when not live', () => {
    store.applyState({ phase: 'READY' })
    render(<ErrorBoundary label="Settings"><Boom fail={true} /></ErrorBoundary>)
    expect(screen.queryByText(/stream is still running/i)).toBeNull()
  })

  it('shows the error message', () => {
    render(<ErrorBoundary label="Stream"><Boom fail={true} /></ErrorBoundary>)
    expect(screen.getByText(/kaboom/)).toBeTruthy()
  })

  it('offers no restart-app action', () => {
    render(<ErrorBoundary label="Stream"><Boom fail={true} /></ErrorBoundary>)
    expect(screen.queryByRole('button', { name: /restart/i })).toBeNull()
  })

  it('Reload recovers the subtree for a non-root boundary', () => {
    const { rerender } = render(<ErrorBoundary label="Settings"><Boom fail={true} /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toBeTruthy()
    rerender(<ErrorBoundary label="Settings"><Boom fail={false} /></ErrorBoundary>)
    act(() => { screen.getByRole('button', { name: /reload/i }).click() })
    expect(screen.getByText('all good')).toBeTruthy()
  })

  it('copies error details through the main-process clipboard', async () => {
    render(<ErrorBoundary label="Stream"><Boom fail={true} /></ErrorBoundary>)
    await act(async () => { screen.getByRole('button', { name: /copy error details/i }).click() })
    expect(copyToClipboard).toHaveBeenCalledTimes(1)
    const payload = copyToClipboard.mock.calls[0][0] as string
    expect(payload).toContain('kaboom')
    expect(payload).toContain('1.0.0')
    expect(payload).toContain('Stream')
  })
})
