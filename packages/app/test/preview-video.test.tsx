import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PreviewVideo } from '../src/renderer/components/PreviewVideo.js'

describe('PreviewVideo', () => {
  it('renders the blurred backdrop behind the contain preview', () => {
    const { container } = render(<PreviewVideo />)
    const videos = container.querySelectorAll('video')
    expect(videos).toHaveLength(2)
    expect(videos[0].className).toContain('preview-backdrop')
    expect(videos[1].className).toContain('preview-video')
  })
})
