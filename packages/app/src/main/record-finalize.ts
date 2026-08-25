/** What a quit-time finalization needs from the rest of main. */
export interface RecordingFinalizerDeps {
  /** Stops the "did the recording die on its own" poll before the deliberate stop. */
  stopHealthPoll: () => void
  stopRecording: () => Promise<unknown>
  /** Upper bound on how long a quit may wait for OBS. Defaults to 2s. */
  timeoutMs?: number
}

/**
 * One-shot StopRecord for the quit path.
 *
 * Recordings are written as fragmented_mp4, so a killed OBS leaves a playable
 * file — but only if StopRecord was issued first, and OBS has exactly one
 * record output, so it must be issued exactly once. The result is memoized:
 * a second close arriving while the first is still deferred joins the same
 * stop instead of sending another.
 *
 * The memo is per-finalizer, and main constructs one only where the app is
 * genuinely on its way out; the wait is boxed so quitting can never hang on
 * an unresponsive OBS, and a failing stop resolves rather than rejecting.
 */
export function createRecordingFinalizer(deps: RecordingFinalizerDeps): () => Promise<void> {
  let pending: Promise<void> | null = null
  return () => {
    if (!pending) {
      deps.stopHealthPoll()
      pending = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, deps.timeoutMs ?? 2000)
        void (async () => {
          try { await deps.stopRecording() } catch (err) { console.warn('[record] stop on quit failed', err) }
          clearTimeout(timer)
          resolve()
        })()
      })
    }
    return pending
  }
}
