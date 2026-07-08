import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PttKeyPicker } from '../src/renderer/components/PttKeyPicker.js'

const bindProps = { keyName: 'F18', keyCode: 188, modifier: null as null }

describe('PttKeyPicker', () => {
  it('renders the current key chip and groups when opened', () => {
    render(<PttKeyPicker {...bindProps} onBind={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'F18' }))
    expect(screen.getByText('Function')).toBeTruthy()
    expect(screen.getByText('Letters')).toBeTruthy()
    expect(screen.getByText('Numbers')).toBeTruthy()
  })

  it('clicking a grid key binds it with the current modifier', () => {
    const onBind = vi.fn()
    render(<PttKeyPicker {...bindProps} modifier="ctrl" onBind={onBind} />)
    fireEvent.click(screen.getByRole('button', { name: 'F18' }))
    fireEvent.click(screen.getByRole('button', { name: 'F19' }))
    expect(onBind).toHaveBeenCalledWith({ key: { code: 189, name: 'F19' }, modifier: 'ctrl' })
  })

  it('adding and removing a modifier rebinds', () => {
    const onBind = vi.fn()
    const { rerender } = render(<PttKeyPicker {...bindProps} onBind={onBind} />)
    fireEvent.click(screen.getByRole('button', { name: '+ modifier' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl' }))
    expect(onBind).toHaveBeenCalledWith({ key: { code: 188, name: 'F18' }, modifier: 'ctrl' })
    rerender(<PttKeyPicker {...bindProps} modifier="ctrl" onBind={onBind} />)
    fireEvent.click(screen.getByRole('button', { name: /remove modifier/i }))
    expect(onBind).toHaveBeenCalledWith({ key: { code: 188, name: 'F18' }, modifier: null })
  })

  it('search filters the grid', () => {
    render(<PttKeyPicker {...bindProps} onBind={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'F18' }))
    fireEvent.change(screen.getByPlaceholderText(/search keys/i), { target: { value: 'pageup' } })
    expect(screen.getByRole('button', { name: 'PageUp' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'F19' })).toBeNull()
  })

  it('warns when a letter or number is bound', () => {
    render(<PttKeyPicker keyName="V" keyCode={47} modifier={null} onBind={vi.fn()} />)
    expect(screen.getByText(/triggers PTT while typing/i)).toBeTruthy()
  })

  it('modifier menu omits a modifier whose codes include the current keyCode', () => {
    // keyCode=29 is Left Ctrl — MODIFIER_CODES.ctrl includes 29.
    // Opening the modifier menu must NOT offer Ctrl, but must offer Alt/Shift/Super.
    render(<PttKeyPicker keyName="KEY_29" keyCode={29} modifier={null} onBind={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ modifier' }))
    expect(screen.queryByRole('button', { name: 'Ctrl' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Alt' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Shift' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Super' })).toBeTruthy()
  })
})
