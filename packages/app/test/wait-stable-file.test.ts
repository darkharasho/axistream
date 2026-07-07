import { describe, it, expect } from 'vitest'
import { waitForStableFile } from '../src/main/wait-stable-file.js'

const noSleep = async () => {}

describe('waitForStableFile', () => {
  it('resolves true once two consecutive polls see the same non-zero size', async () => {
    // OBS keeps flushing after StopRecord resolves — sizes grow, then settle.
    const sizes = [1000, 5000, 9000, 9000]
    let i = 0
    const statSize = async () => sizes[Math.min(i++, sizes.length - 1)]
    const ok = await waitForStableFile(statSize, { sleep: noSleep })
    expect(ok).toBe(true)
    expect(i).toBeGreaterThanOrEqual(4)
  })

  it('returns false when the file never stabilizes within the attempt budget', async () => {
    let n = 0
    const statSize = async () => ++n * 1000
    const ok = await waitForStableFile(statSize, { sleep: noSleep, maxAttempts: 5 })
    expect(ok).toBe(false)
  })

  it('keeps waiting while the file is missing (stat returns null), then settles', async () => {
    const seq: (number | null)[] = [null, null, 4000, 4000]
    let i = 0
    const statSize = async () => seq[Math.min(i++, seq.length - 1)]
    const ok = await waitForStableFile(statSize, { sleep: noSleep })
    expect(ok).toBe(true)
  })

  it('a zero-size file does not count as stable', async () => {
    const seq = [0, 0, 0, 6000, 6000]
    let i = 0
    const statSize = async () => seq[Math.min(i++, seq.length - 1)]
    const ok = await waitForStableFile(statSize, { sleep: noSleep })
    expect(ok).toBe(true)
    expect(i).toBeGreaterThanOrEqual(5)
  })
})
