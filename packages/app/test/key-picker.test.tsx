import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { KeyPicker } from '../src/renderer/components/KeyPicker.js'

const binding = { key: { code: 188, name: 'F18' }, modifier: null as null }

describe('KeyPicker', () => {
  it('renders the current key chip and groups when opened', () => {
    render(<KeyPicker binding={binding} onBind={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'F18' }))
    expect(screen.getByText('Function')).toBeTruthy()
    expect(screen.getByText('Letters')).toBeTruthy()
    expect(screen.getByText('Numbers')).toBeTruthy()
  })

  it('clicking a grid key binds it with the current modifier', () => {
    const onBind = vi.fn()
    render(<KeyPicker binding={{ ...binding, modifier: 'ctrl' }} onBind={onBind} />)
    fireEvent.click(screen.getByRole('button', { name: 'F18' }))
    fireEvent.click(screen.getByRole('button', { name: 'F19' }))
    expect(onBind).toHaveBeenCalledWith({ key: { code: 189, name: 'F19' }, modifier: 'ctrl' })
  })

  it('adding and removing a modifier rebinds', () => {
    const onBind = vi.fn()
    const { rerender } = render(<KeyPicker binding={binding} onBind={onBind} />)
    fireEvent.click(screen.getByRole('button', { name: '+ modifier' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl' }))
    expect(onBind).toHaveBeenCalledWith({ key: { code: 188, name: 'F18' }, modifier: 'ctrl' })
    rerender(<KeyPicker binding={{ ...binding, modifier: 'ctrl' }} onBind={onBind} />)
    fireEvent.click(screen.getByRole('button', { name: /remove modifier/i }))
    expect(onBind).toHaveBeenCalledWith({ key: { code: 188, name: 'F18' }, modifier: null })
  })

  it('search filters the grid', () => {
    render(<KeyPicker binding={binding} onBind={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'F18' }))
    fireEvent.change(screen.getByPlaceholderText(/search keys/i), { target: { value: 'pageup' } })
    expect(screen.getByRole('button', { name: 'PageUp' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'F19' })).toBeNull()
  })

  it('warns when a letter or number is bound', () => {
    render(<KeyPicker binding={{ key: { code: 47, name: 'V' }, modifier: null }} onBind={vi.fn()} />)
    expect(screen.getByText(/triggers PTT while typing/i)).toBeTruthy()
  })

  it('modifier menu omits a modifier whose codes include the current keyCode', () => {
    // keyCode=29 is Left Ctrl — MODIFIER_CODES.ctrl includes 29.
    // Opening the modifier menu must NOT offer Ctrl, but must offer Alt/Shift/Super.
    render(<KeyPicker binding={{ key: { code: 29, name: 'KEY_29' }, modifier: null }} onBind={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ modifier' }))
    expect(screen.queryByRole('button', { name: 'Ctrl' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Alt' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Shift' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Super' })).toBeTruthy()
  })
})

describe('KeyPicker unbound state', () => {
  it('offers to set a key when nothing is bound', () => {
    render(<KeyPicker binding={null} onBind={vi.fn()} />)
    expect(screen.getByRole('button', { name: /set key/i })).toBeInTheDocument()
  })

  it('shows the bound key and a clear affordance when one is set', () => {
    const onClear = vi.fn()
    render(<KeyPicker binding={{ key: { code: 183, name: 'F13' }, modifier: null }} onBind={vi.fn()} onClear={onClear} />)
    expect(screen.getByRole('button', { name: 'F13' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('omits the clear affordance when no onClear is given (push-to-talk always has a key)', () => {
    render(<KeyPicker binding={{ key: { code: 188, name: 'F18' }, modifier: null }} onBind={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull()
  })

  it('binds the chosen key from the unbound state', () => {
    const onBind = vi.fn()
    render(<KeyPicker binding={null} onBind={onBind} />)
    fireEvent.click(screen.getByRole('button', { name: /set key/i }))
    fireEvent.click(screen.getByRole('button', { name: 'F13' }))
    expect(onBind).toHaveBeenCalledWith({ key: { code: 183, name: 'F13' }, modifier: null })
  })
})
