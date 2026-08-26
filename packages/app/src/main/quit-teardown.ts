/** What a quit-time sidecar teardown needs from the rest of main. */
export interface SidecarTeardownDeps {
  stopSidecar: () => Promise<unknown>
  /** Upper bound on how long a quit may wait for OBS. Defaults to 3s. */
  timeoutMs?: number
}

/**
 * One-shot OBS teardown for the quit path.
 *
 * Left unawaited, the stop races the window's destruction: window-all-closed
 * reaches app.quit(), the main process dies mid-teardown, and OBS — plus, on
 * Linux, the cage compositor hosting it — is left running with nothing able to
 * close it. Deferring the close on this promise makes the app outlive its own
 * OBS.
 *
 * Memoized like the recording finalizer: a second close arriving while the
 * first is still deferred joins the same stop. The wait is boxed so quitting
 * can never hang on an unresponsive OBS, and a failing stop resolves rather
 * than rejecting — losing the window's close handler to an exception would
 * strand the app with no way out.
 */
export function createSidecarTeardown(deps: SidecarTeardownDeps): () => Promise<void> {
  let pending: Promise<void> | null = null
  return () => {
    if (!pending) {
      pending = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, deps.timeoutMs ?? 3000)
        void (async () => {
          try { await deps.stopSidecar() } catch (err) { console.warn('[obs] stop on quit failed', err) }
          clearTimeout(timer)
          resolve()
        })()
      })
    }
    return pending
  }
}
