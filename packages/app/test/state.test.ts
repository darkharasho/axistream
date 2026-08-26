import { describe, it, expect } from 'vitest'
import { isStreamingPhase, type StreamPhase } from '../src/shared/state.js'

const ALL_PHASES: StreamPhase[] = [
  'SETTING_UP', 'PREPARING_CAPTURE', 'CHOOSING_CAPTURE', 'AWAITING_APPROVAL',
  'NEEDS_YOUTUBE', 'NEEDS_TITLE', 'READY',
  'GOING_LIVE', 'STARTING_ON_YOUTUBE', 'LIVE', 'RECONNECTING', 'ENDED', 'ERROR',
]

describe('isStreamingPhase', () => {
  it('is true for every phase in which OBS is already streaming, including the YouTube-confirmation window', () => {
    expect(ALL_PHASES.filter(isStreamingPhase)).toEqual(['GOING_LIVE', 'STARTING_ON_YOUTUBE', 'LIVE', 'RECONNECTING'])
  })

  it('is false for every other phase', () => {
    const rest = ALL_PHASES.filter((p) => !isStreamingPhase(p))
    expect(rest).toEqual(['SETTING_UP', 'PREPARING_CAPTURE', 'CHOOSING_CAPTURE', 'AWAITING_APPROVAL', 'NEEDS_YOUTUBE', 'NEEDS_TITLE', 'READY', 'ENDED', 'ERROR'])
  })
})
