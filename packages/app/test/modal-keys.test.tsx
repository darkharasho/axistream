import { describe, it, expect, vi } from 'vitest'
import { useRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { useModalKeys } from '../src/renderer/use-modal-keys.js'

function Modal({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useModalKeys(ref, onClose)
  return (
    <div ref={ref}>
      <button>first</button>
      <button>last</button>
    </div>
  )
}

describe('useModalKeys', () => {
  it('Escape invokes onClose', () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys', () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('wraps Tab from the last focusable back to the first', () => {
    render(<Modal onClose={() => {}} />)
    const last = screen.getByText('last')
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByText('first'))
  })

  it('wraps Shift+Tab from the first focusable to the last', () => {
    render(<Modal onClose={() => {}} />)
    screen.getByText('first').focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByText('last'))
  })

  it('restores focus to the previously focused element on unmount', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const { unmount } = render(<Modal onClose={() => {}} />)
    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('does not re-run its effect when onClose identity changes', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const { rerender } = render(<Modal onClose={() => {}} />)
    screen.getByText('last').focus()
    // A fresh inline callback each render must not tear down and restore focus.
    rerender(<Modal onClose={() => {}} />)
    expect(document.activeElement).toBe(screen.getByText('last'))
    trigger.remove()
  })
})
