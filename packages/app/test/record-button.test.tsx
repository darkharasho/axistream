import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RecordButton } from '../src/renderer/components/RecordButton.js'
import type { RecordingState } from '../src/shared/state.js'

const idle: RecordingState = { active: false, startedAt: null, dir: '/home/u/Videos/AxiStream', lastPath: null, error: null }

const api = (over: Record<string, any> = {}) => ({
  startRecording: vi.fn(async () => ({ ok: true })),
  stopRecording: vi.fn(async () => ({ ok: true, outputPath: '/home/u/v.mp4' })),
  openRecording: vi.fn(async () => ({ ok: true })),
  ...over,
}) as any

describe('RecordButton', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('starts a recording when idle', () => {
    const axi = api()
    render(<RecordButton recording={idle} disabled={false} axi={axi} />)

    fireEvent.click(screen.getByRole('button', { name: /record/i }))

    expect(axi.startRecording).toHaveBeenCalled()
  })

  it('shows elapsed time derived from startedAt while active', () => {
    vi.setSystemTime(new Date('2026-08-24T12:05:30Z'))
    const active: RecordingState = { ...idle, active: true, startedAt: new Date('2026-08-24T12:00:00Z').getTime() }

    render(<RecordButton recording={active} disabled={false} axi={api()} />)

    expect(screen.getByText('5:30')).toBeTruthy()
  })

  it('stops the recording when active', () => {
    const axi = api()
    const active: RecordingState = { ...idle, active: true, startedAt: Date.now() }
    render(<RecordButton recording={active} disabled={false} axi={axi} />)

    fireEvent.click(screen.getByRole('button', { name: /stop recording/i }))

    expect(axi.stopRecording).toHaveBeenCalled()
  })

  it('is disabled with an explanation when an audio test is running', () => {
    render(<RecordButton recording={idle} disabled axi={api()} />)

    const btn = screen.getByRole('button', { name: /record/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.title).toMatch(/audio test/i)
  })

  it('offers to open the last recording once one has finished', () => {
    const axi = api()
    render(<RecordButton recording={{ ...idle, lastPath: '/home/u/v.mp4' }} disabled={false} axi={axi} />)

    fireEvent.click(screen.getByRole('button', { name: /open recording/i }))

    expect(axi.openRecording).toHaveBeenCalledWith('/home/u/v.mp4')
  })
})
