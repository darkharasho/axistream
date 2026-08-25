import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ToastHost } from '../src/renderer/components/ToastHost.js'
import { createToastStore } from '../src/renderer/toasts.js'

describe('ToastHost', () => {
  it('renders nothing when empty', () => {
    const store = createToastStore()
    const { container } = render(<ToastHost store={store} />)
    expect(container.firstChild).toBeNull()
  })

  it('uses role=alert for errors', () => {
    const store = createToastStore()
    act(() => { store.push({ kind: 'error', message: 'Update failed' }) })
    render(<ToastHost store={store} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Update failed')
  })

  it('uses role=status for info and success', () => {
    const store = createToastStore()
    act(() => { store.push({ kind: 'success', message: 'Plugin installed' }) })
    render(<ToastHost store={store} />)
    expect(screen.getByRole('status')).toHaveTextContent('Plugin installed')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders detail when present', () => {
    const store = createToastStore()
    act(() => { store.push({ kind: 'error', message: 'Announce failed', detail: 'HTTP 401' }) })
    render(<ToastHost store={store} />)
    expect(screen.getByText('HTTP 401')).toBeTruthy()
  })

  it('omits detail when absent', () => {
    const store = createToastStore()
    act(() => { store.push({ kind: 'error', message: 'Announce failed' }) })
    const { container } = render(<ToastHost store={store} />)
    expect(container.querySelector('.toast-detail')).toBeNull()
  })

  it('dismiss control removes the toast', () => {
    const store = createToastStore()
    act(() => { store.push({ kind: 'error', message: 'Announce failed' }) })
    render(<ToastHost store={store} />)
    act(() => { screen.getByRole('button', { name: /dismiss/i }).click() })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('re-renders when a toast arrives after mount', () => {
    const store = createToastStore()
    render(<ToastHost store={store} />)
    act(() => { store.push({ kind: 'error', message: 'Late arrival' }) })
    expect(screen.getByRole('alert')).toHaveTextContent('Late arrival')
  })
})
