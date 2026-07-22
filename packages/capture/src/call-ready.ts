const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// obs-websocket RequestStatus codes that a retry can never turn into a success.
// 600 ResourceNotFound / 601 ResourceAlreadyExists are deterministic: retrying
// e.g. RemoveScene on a scene that does not exist just burns the whole retry
// budget (and starves the genuinely-transient NotReady calls around it).
const NON_RETRYABLE_OBS_CODES = new Set([600, 601])

function isRetryable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code !== 'number' || !NON_RETRYABLE_OBS_CODES.has(code)
}

export async function callReady<T>(
  fn: () => Promise<T>,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<T> {
  const tries = opts.tries ?? 25
  const delayMs = opts.delayMs ?? 800
  let lastErr: unknown
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (!isRetryable(e)) throw e
      if (i < tries - 1) await sleep(delayMs)
    }
  }
  throw lastErr
}
