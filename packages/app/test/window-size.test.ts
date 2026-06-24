import { describe, it, expect } from 'vitest'
import { computeWindowSize } from '../src/main/window-size.js'

const MIN = { width: 820, height: 560 }

describe('computeWindowSize', () => {
  it('scales a 16:9 work area to 60%, preserving aspect ratio', () => {
    expect(computeWindowSize({ width: 2560, height: 1400 }, 0.6, MIN)).toEqual({ width: 1536, height: 840 })
  })

  it('scales an ultrawide work area to 60%, preserving the wide ratio', () => {
    expect(computeWindowSize({ width: 3440, height: 1400 }, 0.6, MIN)).toEqual({ width: 2064, height: 840 })
  })

  it('applies the floor on both axes for a small work area', () => {
    expect(computeWindowSize({ width: 1366, height: 728 }, 0.6, MIN)).toEqual({ width: 820, height: 560 })
  })

  it('clamps only the axis that falls below the floor', () => {
    // 2560*0.6 = 1536 (>= 820, kept); 800*0.6 = 480 (< 560, floored)
    expect(computeWindowSize({ width: 2560, height: 800 }, 0.6, MIN)).toEqual({ width: 1536, height: 560 })
  })

  it('never returns below the floor at the exact boundary', () => {
    // 1366*0.6 = 819.6 -> round 820 (== floor); 933*0.6 = 559.8 -> round 560 (== floor)
    expect(computeWindowSize({ width: 1366, height: 933 }, 0.6, MIN)).toEqual({ width: 820, height: 560 })
  })
})
