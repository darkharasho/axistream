import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '../src/renderer/components/ErrorBoundary.js'
import { Sidebar } from '../src/renderer/components/Sidebar.js'
import { store } from '../src/renderer/store.js'

const Boom = () => { throw new Error('settings exploded') }

beforeEach(() => {
  ;(globalThis as any).axi = { copyToClipboard: vi.fn(), appVersion: vi.fn().mockResolvedValue('1.0.0') }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

describe('screen-level boundaries', () => {
  it('a crashed screen leaves the sidebar and live controls mounted', () => {
    store.applyState({ phase: 'LIVE' })
    const state = store.getState()
    render(
      <div className="app">
        <Sidebar active="settings" state={state} onNav={() => {}} axi={(globalThis as any).axi} />
        <ErrorBoundary label="Settings"><Boom /></ErrorBoundary>
      </div>
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/Something broke in Settings/i)
    // The sidebar survived: its live indicator is still on screen.
    expect(screen.getByText(/On air/i)).toBeTruthy()
  })
})
