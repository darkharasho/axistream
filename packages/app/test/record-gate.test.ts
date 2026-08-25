import { describe, it, expect } from 'vitest'
import { recordStartRejection } from '../src/main/record-gate.js'

const idle = { startInFlight: false, recordingActive: false, audioTestActive: false }

describe('recordStartRejection', () => {
  it('lets an idle app start recording', () => {
    expect(recordStartRejection(idle)).toBeNull()
  })

  it('refuses a second Record click while the first start is still settling', () => {
    // The double-click case: the button still reads "Record" for the ~300ms
    // the start takes, and a second start would leave OBS recording with
    // recording.active false — unstoppable from the UI.
    expect(recordStartRejection({ ...idle, startInFlight: true })).toBe('already starting')
  })

  it('refuses while the audio test owns the single record output', () => {
    expect(recordStartRejection({ ...idle, audioTestActive: true })).toBe('an audio test is running')
  })

  it('refuses while a recording is already running', () => {
    expect(recordStartRejection({ ...idle, recordingActive: true })).toBe('already recording')
  })

  it('reports the in-flight start ahead of the other conditions', () => {
    expect(recordStartRejection({ startInFlight: true, recordingActive: true, audioTestActive: true }))
      .toBe('already starting')
  })
})
