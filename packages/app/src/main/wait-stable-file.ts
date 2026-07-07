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

/** True when the buffer's TOP-LEVEL mp4 atoms include a moov box. OBS writes
 *  the moov index last when finalizing a regular mp4 — a size-stable file
 *  without it plays as 0:00 in Chromium. Walks the top-level atom chain only
 *  (never matches 'moov' bytes inside mdat); malformed tails just end the walk. */
export function hasTopLevelMoov(buf: Uint8Array): boolean {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let off = 0
  while (off + 8 <= buf.byteLength) {
    let size = view.getUint32(off)
    const typ = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7])
    if (typ === 'moov') return true
    if (size === 1) {
      if (off + 16 > buf.byteLength) return false
      const hi = view.getUint32(off + 8)
      const lo = view.getUint32(off + 12)
      size = hi * 4294967296 + lo
    }
    if (size < 8) return false
    off += size
  }
  return false
}
