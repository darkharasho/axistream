export interface PollForLiveDeps {
  confirm: () => Promise<boolean>
  pollMs: number
  maxAttempts: number
  sleep?: (ms: number) => Promise<void>
  shouldStop?: () => boolean
}

// Poll confirm() until it returns true (resolve true), shouldStop() flips
// (resolve false), or maxAttempts is exhausted (resolve false). confirm()
// rejections are swallowed and treated as "not live yet".
export async function pollForLive(d: PollForLiveDeps): Promise<boolean> {
  const sleep = d.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  for (let i = 0; i < d.maxAttempts; i++) {
    if (d.shouldStop?.()) return false
    if (await d.confirm().catch(() => false)) return true
    if (i < d.maxAttempts - 1) await sleep(d.pollMs)
  }
  return false
}
