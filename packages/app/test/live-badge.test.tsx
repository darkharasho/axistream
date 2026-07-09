import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LiveBadge } from '../src/renderer/components/LiveBadge.js'

describe('LiveBadge', () => {
  it('shows PREVIEW when not live', () => {
    render(<LiveBadge phase="READY" liveUnconfirmed={false} durationMs={0} />)
    expect(screen.getByText(/PREVIEW/)).toBeTruthy()
  })

  it('shows "Starting on YouTube" during STARTING_ON_YOUTUBE', () => {
    render(<LiveBadge phase="STARTING_ON_YOUTUBE" liveUnconfirmed={false} durationMs={0} />)
    expect(screen.getByText(/Starting on YouTube/i)).toBeTruthy()
  })

  it('shows a clean LIVE badge when confirmed', () => {
    render(<LiveBadge phase="LIVE" liveUnconfirmed={false} durationMs={5000} />)
    expect(screen.getByText('LIVE')).toBeTruthy()
    expect(screen.queryByText(/hasn.t started/i)).toBeNull()
  })

  it('shows a warning sub-line when live but unconfirmed', () => {
    render(<LiveBadge phase="LIVE" liveUnconfirmed={true} durationMs={5000} />)
    expect(screen.getByText(/hasn.t started your broadcast/i)).toBeTruthy()
  })
})
