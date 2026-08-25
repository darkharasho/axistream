/** The three conditions that can refuse a start-recording request. */
export interface RecordStartConditions {
  /** A previous start is between StartRecord and recording.active flipping true. */
  startInFlight: boolean
  recordingActive: boolean
  audioTestActive: boolean
}

/**
 * Why a start-recording request is refused, or null when it may proceed.
 *
 * OBS has exactly one record output, so the six-second audio test and a VOD
 * recording cannot coexist. The start window matters just as much: a second
 * Record click landing before recording.active flips true would race the first
 * and both would stomp the same shared SimpleOutput profile parameters, leaving
 * OBS recording with no state to stop it by.
 */
export function recordStartRejection(c: RecordStartConditions): string | null {
  // In-flight is checked first because it is the condition with no on-screen
  // affordance yet — the button still reads "Record" while a start is settling.
  if (c.startInFlight) return 'already starting'
  if (c.audioTestActive) return 'an audio test is running'
  if (c.recordingActive) return 'already recording'
  return null
}
