import { callReady } from './call-ready.js'

export interface ProfileDeps {
  call: <T = unknown>(req: string, params?: object) => Promise<T>
  profileName?: string
  // Retry bounds for the profile calls (OBS rejects them with code 600 for a
  // moment right after startup). Defaults match callReady (25 tries × 800ms).
  tries?: number
  delayMs?: number
}

const PROFILE = 'AxiStream'

/** Ensure OBS is on an AxiStream-owned profile with no external (YouTube) auth.
 *
 *  A profile that carries external auth (OBS's `[Auth] Type=YouTube - RTMP`)
 *  makes OBS route "Start Streaming" through its YouTube *broadcast* flow instead
 *  of a plain RTMP push. In our headless setup that flow silently aborts, so
 *  go-live returns success but never sends a single byte — confirmed 2026-06-24:
 *  with auth present `StartStream` produced zero RTMP activity; with it removed,
 *  OBS connected to the RTMP URL. A freshly created profile has no auth, so this
 *  switches us onto one.
 *
 *  Each call is wrapped in callReady because OBS rejects profile requests (code
 *  600) for a short window after startup. Best-effort and idempotent: returns the
 *  active profile name, or null if the calls keep failing (caller keeps going —
 *  go-live just inherits whatever profile is current). Never throws. */
export async function ensureCleanProfile(deps: ProfileDeps): Promise<string | null> {
  const name = deps.profileName ?? PROFILE
  const ready = <T>(fn: () => Promise<T>) => callReady(fn, { tries: deps.tries, delayMs: deps.delayMs })
  try {
    const { profiles, currentProfileName } =
      await ready(() => deps.call<{ profiles: string[]; currentProfileName: string }>('GetProfileList'))
    if (!profiles.includes(name)) await ready(() => deps.call('CreateProfile', { profileName: name }))
    if (currentProfileName !== name) await ready(() => deps.call('SetCurrentProfile', { profileName: name }))
    return name
  } catch {
    return null
  }
}
