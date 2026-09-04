import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select, type SelectOption } from '../src/renderer/components/Select.js'

const OPTIONS: SelectOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
  { value: 'x', label: 'X-ray', note: 'unavailable', disabled: true },
  { value: 'c', label: 'Charlie' },
]

const onChange = vi.fn()
const mount = (value = 'a') =>
  render(<Select label="Thing" value={value} options={OPTIONS} onChange={onChange} />)

describe('Select', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the selected option on the trigger and no list until opened', () => {
    mount('b')

    expect(screen.getByLabelText('Thing')).toHaveTextContent('Bravo')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  // A stored value with no matching row would otherwise render a blank
  // trigger — showing the raw value is at least honest about what is stored.
  it('falls back to the raw value when no option matches', () => {
    mount('gone')

    expect(screen.getByLabelText('Thing')).toHaveTextContent('gone')
  })

  it('picks an option on click and closes', async () => {
    mount()

    await userEvent.click(screen.getByLabelText('Thing'))
    await userEvent.click(screen.getByRole('option', { name: 'Charlie' }))

    expect(onChange).toHaveBeenCalledWith('c')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('does not re-send the value already selected', async () => {
    mount('b')

    await userEvent.click(screen.getByLabelText('Thing'))
    await userEvent.click(screen.getByRole('option', { name: 'Bravo' }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('ignores a disabled row and stays open', async () => {
    mount()

    await userEvent.click(screen.getByLabelText('Thing'))
    await userEvent.click(screen.getByRole('option', { name: /X-ray/ }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('renders a disabled row with its reason', async () => {
    mount()

    await userEvent.click(screen.getByLabelText('Thing'))

    const row = screen.getByRole('option', { name: /X-ray/ })
    expect(row).toHaveAttribute('aria-disabled', 'true')
    expect(row).toHaveTextContent('unavailable')
  })

  it('opens on ArrowDown and steps over disabled rows', async () => {
    mount('b')

    screen.getByLabelText('Thing').focus()
    await userEvent.keyboard('{ArrowDown}')
    // Opens on the current selection (Bravo), so one more press must land on
    // Charlie — skipping X-ray, which cannot be chosen.
    await userEvent.keyboard('{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('closes on Escape without choosing, and returns focus to the trigger', async () => {
    mount()

    const trigger = screen.getByLabelText('Thing')
    await userEvent.click(trigger)
    await userEvent.keyboard('{Escape}')

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('closes on a click outside', async () => {
    render(<>
      <Select label="Thing" value="a" options={OPTIONS} onChange={onChange} />
      <button type="button">elsewhere</button>
    </>)

    await userEvent.click(screen.getByLabelText('Thing'))
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  // The panel it lives in scrolls; a popup left floating over unrelated
  // content after a scroll is worse than one that dismisses itself.
  it('closes when an ancestor scrolls', async () => {
    mount()

    await userEvent.click(screen.getByLabelText('Thing'))
    fireEvent.scroll(window)

    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
