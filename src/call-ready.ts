const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
      if (i < tries - 1) await sleep(delayMs)
    }
  }
  throw lastErr
}
