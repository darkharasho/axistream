// Stopping the virtual cam is not the same as it being stopped.
//
// `StopVirtualCam` resolves as soon as obs-websocket acknowledges the request,
// but OBS tears the output down asynchronously — ~27ms later in the log that
// prompted this module. Anything that runs in that window sees an output that
// is still active: `SetVideoSettings` (obs_reset_video) is refused with
// OBS_VIDEO_CURRENTLY_ACTIVE, and `StartVirtualCam` is refused because the
// previous run has not released yet. Both come back as RequestStatus 500.
//
// So these wait for the state OBS is actually in rather than for it to answer.
// Everything here is best-effort in the house style: never throws, reports
// what happened as a boolean so the caller can log it.

export interface VirtualCamDeps {
  call(request: string): Promise<unknown>
  sleep(ms: number): Promise<void>
}

export interface VirtualCamWaitOpts {
  /** Status polls before giving up. */
  tries?: number
  /** Delay between polls. */
  delayMs?: number
}

/** null when the status could not be read at all, which is not the same as
 *  "the cam is off" — the caller must not treat an unreachable OBS as stopped. */
async function readActive(d: VirtualCamDeps): Promise<boolean | null> {
  try {
    const st = await d.call('GetVirtualCamStatus') as { outputActive?: boolean } | null
    return typeof st?.outputActive === 'boolean' ? st.outputActive : null
  } catch { return null }
}

/** Stop the virtual cam and wait for OBS to finish releasing the output.
 *  Returns true once the cam is confirmed stopped. False means the wait ran out
 *  (or status was unreadable) — the caller should carry on regardless, since a
 *  preview that never comes back is worse than one that flickers. */
export async function stopVirtualCam(d: VirtualCamDeps, opts: VirtualCamWaitOpts = {}): Promise<boolean> {
  const tries = opts.tries ?? 40
  const delayMs = opts.delayMs ?? 25
  try { await d.call('StopVirtualCam') } catch { /* already stopped, or OBS gone */ }
  for (let i = 0; i < tries; i++) {
    if (await readActive(d) === false) return true
    await d.sleep(delayMs)
  }
  return false
}

/** Start the virtual cam, retrying while OBS is still letting go of the previous
 *  run. A single StartVirtualCam that lands too early returns 500 and, before
 *  this existed, was never retried — so the in-app preview stayed dead for the
 *  rest of the session while the stream itself was fine. */
export async function startVirtualCam(d: VirtualCamDeps, opts: VirtualCamWaitOpts = {}): Promise<boolean> {
  const tries = opts.tries ?? 20
  const delayMs = opts.delayMs ?? 100
  for (let i = 0; i < tries; i++) {
    try {
      await d.call('StartVirtualCam')
      // Trust the status, not the ack: StartVirtualCam can report success and
      // still leave the output down, which is the failure the renderer cannot
      // see (the device node keeps serving OBS's placeholder frame).
      if (await readActive(d) !== false) return true
    } catch {
      // 500 here is the expected racy case; anything else is equally retryable
      // within this budget, and giving up early costs the preview.
      if (await readActive(d) === true) return true
    }
    if (i < tries - 1) await d.sleep(delayMs)
  }
  return false
}
