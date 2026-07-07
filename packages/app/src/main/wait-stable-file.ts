export interface WaitOpts {
  sleep?: (ms: number) => Promise<void>
  intervalMs?: number
  maxAttempts?: number
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** OBS keeps flushing the recording after StopRecord resolves (the file was
 *  observed growing 12→18 MB post-return), and a regular mp4's moov index is
 *  written last — reading too early truncates it into an unplayable clip.
 *  Poll the size until two consecutive polls agree on a non-zero value.
 *  Returns false when the budget runs out (caller may still try the read). */
export async function waitForStableFile(
  statSize: () => Promise<number | null>,
  opts: WaitOpts = {},
): Promise<boolean> {
  const sleep = opts.sleep ?? defaultSleep
  const intervalMs = opts.intervalMs ?? 250
  const maxAttempts = opts.maxAttempts ?? 40
  let prev: number | null = null
  for (let i = 0; i < maxAttempts; i++) {
    const size = await statSize().catch(() => null)
    if (size !== null && size > 0 && size === prev) return true
    prev = size
    await sleep(intervalMs)
  }
  return false
}
