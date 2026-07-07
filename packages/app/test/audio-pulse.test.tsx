import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AudioPulse } from '../src/renderer/components/AudioPulse.js'

describe('AudioPulse', () => {
  it('is idle at level 0', () => {
    const { container } = render(<AudioPulse level={0} />)
    expect(container.firstElementChild!.className).not.toContain('live')
  })
  it('goes live above the threshold and scales bars', () => {
    const { container } = render(<AudioPulse level={0.5} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('live')
    expect(root.querySelectorAll('rect')).toHaveLength(3)
  })
})
