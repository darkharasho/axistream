import { describe, it, expect } from 'vitest'
import { computeWindowSize, fitWidthForCapture, toggleWindowSize, isFittedWidth } from '../src/main/window-size.js'

const MIN = { width: 820, height: 560 }

describe('computeWindowSize', () => {
  it('scales a 16:9 work area to 60%, preserving aspect ratio', () => {
    // 2560x1440 is exactly 16:9: 1536x864 keeps the ratio, cap is a no-op
    expect(computeWindowSize({ width: 2560, height: 1440 }, 0.6, MIN)).toEqual({ width: 1536, height: 864 })
  })

  it('caps ultrawide width at 16:9 of the height', () => {
    // 3440*0.6 = 2064 would be cinema-wide; height 840 caps width at 840*16/9 = 1493
    expect(computeWindowSize({ width: 3440, height: 1400 }, 0.6, MIN)).toEqual({ width: 1493, height: 840 })
  })

  it('the 16:9 cap never pushes width below the floor', () => {
    // tall-narrow area: height floors to 560; 560*16/9 = 996 > 820 floor, width from area = 480 -> floored to 820
    expect(computeWindowSize({ width: 800, height: 800 }, 0.6, MIN)).toEqual({ width: 820, height: 560 })
  })

  it('applies the floor on both axes for a small work area', () => {
    expect(computeWindowSize({ width: 1366, height: 728 }, 0.6, MIN)).toEqual({ width: 820, height: 560 })
  })

  it('clamps only the axis that falls below the floor', () => {
    // 800*0.6 = 480 (< 560, floored to 560); width then capped at 560*16/9 = 996
    expect(computeWindowSize({ width: 2560, height: 800 }, 0.6, MIN)).toEqual({ width: 996, height: 560 })
  })

  it('never returns below the floor at the exact boundary', () => {
    // 1366*0.6 = 819.6 -> round 820 (== floor); 933*0.6 = 559.8 -> round 560 (== floor)
    expect(computeWindowSize({ width: 1366, height: 933 }, 0.6, MIN)).toEqual({ width: 820, height: 560 })
  })
})

describe('fitWidthForCapture', () => {
  it('ultrawide capture widens the window to remove bars', () => {
    // content height 840, capture 3440x1440 → 200 + 840*3440/1440 = 200 + 2006.66 → 2207
    expect(fitWidthForCapture(200, 840, 3440, 1440, 820, 3400)).toBe(2207)
  })
  it('clamps to the work-area max', () => {
    expect(fitWidthForCapture(200, 840, 3440, 1440, 820, 1800)).toBe(1800)
  })
  it('clamps to the window minimum', () => {
    expect(fitWidthForCapture(200, 300, 400, 1440, 820, 3400)).toBe(820)
  })
  it('degenerate capture dims return the minimum', () => {
    expect(fitWidthForCapture(200, 840, 0, 0, 820, 3400)).toBe(820)
  })
})

describe('toggleWindowSize', () => {
  const WA = { width: 2560, height: 1440 }

  it('fits the width to the capture aspect when not currently fitted', () => {
    // content 1400x864 (default-ish), capture 3440x1440 → fit width 200 + 864*3440/1440 = 2264
    const next = toggleWindowSize({ width: 1400, height: 864 }, WA, 0.6, MIN, 200, 3440, 1440)
    expect(next).toEqual({ width: 2264, height: 864 })
  })

  it('snaps back to the default window size when already fitted', () => {
    // start already at the fit width for this capture/height → toggle returns computeWindowSize
    const fitW = fitWidthForCapture(200, 864, 3440, 1440, MIN.width, WA.width) // 2264
    expect(toggleWindowSize({ width: fitW, height: 864 }, WA, 0.6, MIN, 200, 3440, 1440))
      .toEqual(computeWindowSize(WA, 0.6, MIN))
  })

  it('treats a within-tolerance width as fitted (rounding slack)', () => {
    const fitW = fitWidthForCapture(200, 864, 3440, 1440, MIN.width, WA.width)
    expect(toggleWindowSize({ width: fitW - 2, height: 864 }, WA, 0.6, MIN, 200, 3440, 1440))
      .toEqual(computeWindowSize(WA, 0.6, MIN))
  })
})

describe('isFittedWidth', () => {
  it('true within the same ±2 tolerance the toggle uses', () => {
    const fitW = fitWidthForCapture(200, 864, 3440, 1440, MIN.width, 2560) // clamped to 2560
    expect(isFittedWidth(200, fitW, 864, 3440, 1440, MIN.width, 2560)).toBe(true)
    expect(isFittedWidth(200, fitW - 2, 864, 3440, 1440, MIN.width, 2560)).toBe(true)
    expect(isFittedWidth(200, fitW - 3, 864, 3440, 1440, MIN.width, 2560)).toBe(false)
  })
  it('false for degenerate capture dims', () => {
    expect(isFittedWidth(200, 820, 864, 0, 0, MIN.width, 2560)).toBe(false)
  })
})
