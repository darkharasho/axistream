import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatChips } from '../src/renderer/components/StatChips.js'
import type { LiveStats, CaptureMeta } from '../src/shared/state.js'

const capture: CaptureMeta = { sourceLabel: 'GW2', width: 2560, height: 1440, outputWidth: 2560, outputHeight: 1440, fps: 60 }
const stats = (over: Partial<LiveStats> = {}): LiveStats => ({
  bitrateKbps: 9000, droppedFrames: 0, droppedPct: 0, durationMs: 1000,
  encoder: 'NVENC', cpuPct: 10, reconnecting: false, ...over,
})

describe('StatChips', () => {
  it('idle chip shows the passed encoder label, not a hardcoded one', () => {
    render(<StatChips stats={null} capture={capture} encoder="NVENC" />)
    expect(screen.getByText('NVENC · 1440p60')).toBeInTheDocument()
  })

  it('dropped chip is good below 1%', () => {
    render(<StatChips stats={stats({ droppedFrames: 3, droppedPct: 0.2 })} capture={capture} encoder="NVENC" />)
    expect(screen.getByText('3 dropped').className).toContain('good')
  })

  it('dropped chip warns at 1–5% and shows the percentage', () => {
    render(<StatChips stats={stats({ droppedFrames: 342, droppedPct: 2.3 })} capture={capture} encoder="NVENC" />)
    const chip = screen.getByText('342 dropped · 2.3%')
    expect(chip.className).toContain('warn')
    expect(chip.className).not.toContain('good')
  })

  it('dropped chip is bad above 5%', () => {
    render(<StatChips stats={stats({ droppedFrames: 900, droppedPct: 7.5 })} capture={capture} encoder="NVENC" />)
    expect(screen.getByText('900 dropped · 7.5%').className).toContain('bad')
  })
})
