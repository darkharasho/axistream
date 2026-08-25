import { describe, it, expect } from 'vitest'
import { webcamToast } from '../src/main/webcam-availability.js'

describe('webcamToast', () => {
  it('fires once on the transition into unavailable', () => {
    expect(webcamToast(true, false, true)).toBe('unavailable')
  })

  it('stays silent while it remains unavailable', () => {
    // The chip in AppState carries the ongoing condition; the toast channel
    // carries only discrete events. Re-toasting every reconcile would spam.
    expect(webcamToast(false, false, true)).toBeNull()
  })

  it('stays silent on recovery', () => {
    expect(webcamToast(false, true, true)).toBeNull()
  })

  it('stays silent when the webcam is disabled', () => {
    expect(webcamToast(true, false, false)).toBeNull()
  })
})
