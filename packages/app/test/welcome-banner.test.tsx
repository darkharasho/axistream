import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WelcomeBanner } from '../src/renderer/components/WelcomeBanner.js'

describe('WelcomeBanner', () => {
  it('offers setup without blocking anything', () => {
    render(<WelcomeBanner onSetUp={() => {}} onDismiss={() => {}} />)

    expect(screen.getByText(/two-minute setup/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /set up/i })).toBeInTheDocument()
  })

  it('opens the wizard from Set up', async () => {
    const onSetUp = vi.fn()
    render(<WelcomeBanner onSetUp={onSetUp} onDismiss={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: /set up/i }))

    expect(onSetUp).toHaveBeenCalledOnce()
  })

  it('dismisses from the close button', async () => {
    const onDismiss = vi.fn()
    render(<WelcomeBanner onSetUp={() => {}} onDismiss={onDismiss} />)

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
