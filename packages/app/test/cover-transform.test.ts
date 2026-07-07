import { describe, it, expect } from 'vitest'
import { containContentRect } from '../src/renderer/cover-transform.js'

describe('containContentRect', () => {
  it('exact aspect fills the element', () => {
    expect(containContentRect(1920, 1080, 960, 540)).toEqual({ left: 0, top: 0, width: 960, height: 540 })
  })
  it('wider video letterboxes top/bottom (positive top)', () => {
    // 21:9 in 16:9: scale by width; height shrinks
    const result = containContentRect(2100, 900, 800, 450)
    expect(result.left).toBe(0)
    expect(result.width).toBe(800)
    expect(result.height).toBeCloseTo(342.857, 2)
    expect(result.top).toBeCloseTo(53.571, 2)
  })
  it('taller video pillarboxes left/right (positive left)', () => {
    expect(containContentRect(900, 900, 800, 450)).toEqual({ left: 175, top: 0, width: 450, height: 450 })
  })
  it('degenerate dims fall back to the element box', () => {
    expect(containContentRect(0, 0, 800, 450)).toEqual({ left: 0, top: 0, width: 800, height: 450 })
  })
})
