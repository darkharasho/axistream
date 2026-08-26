// packages/app/test/hotkey-window.test.ts
// Two residual holes in the rebuild serializer, both found by re-review after
// the coalescing fix landed. Each is a one-microtask window; each admits the
// failure the serializer exists to prevent.
import { describe, it, expect } from 'vitest'
import { HotkeyService } from '../src/main/HotkeyService.js'

const F13 = { code: 183, name: 'F13' }
const flush = () => new Promise((r) => setImmediate(r))

function serialHarness() {
  const live = new Set<number>()
  let maxLive = 0
  const gates: (() => void)[] = []
  let n = 0
  const svc = new HotkeyService({
    selectBackend: async () => ({
      backend: {
        available: async () => true,
        bindAll: async () => {
          const id = ++n
          // Deferred: the session does not become live until the test says so.
          await new Promise<void>((resolve) => { gates.push(resolve) })
          live.add(id)
          maxLive = Math.max(maxLive, live.size)
          return {
            onActivated() {},
            onDeactivated() {},
            close: async () => { live.delete(id) },
          }
        },
      },
      mode: 'passthrough',
    }),
    bindings: () => ({ goLive: { key: F13, modifier: null }, micMute: null, masks: null, record: null }),
    pttBinding: () => null,
    actions: {} as never,
    onPttEdge: () => {},
    onMode: () => {},
    now: () => 0,
  })
  return { svc, gates, live, calls: () => n, maxLive: () => maxLive }
}

describe('the window between a finished rebuild and its queued successor', () => {
  it('does not let a rebuild requested in that window start a second session', async () => {
    const h = serialHarness()
    const p1 = h.svc.rebuild()
    const p2 = h.svc.rebuild() // queued as `next`
    await flush()

    // Resolving the first rebuild nulls `current` in run()'s finally, but the
    // queued chain only resumes a microtask later. A caller landing in that
    // window used to take the `!current` fast path and run alongside it.
    // The caller re-requests from inside its OWN continuation: by then
    // run()'s finally has nulled `current`, while the queued chain has not
    // yet resumed to claim it.
    const p3 = p1.then(() => h.svc.rebuild())
    h.gates[0]()
    await flush()
    // Open every gate, including any a regression would have opened extra.
    for (let i = 0; i < 5; i++) { h.gates.forEach((g) => g()); await flush() }
    await Promise.all([p1, p2, p3])

    expect(h.maxLive()).toBe(1)
    expect(h.calls()).toBe(2) // p2 and p3 coalesce into one trailing rebuild
  })

  it('close() waits for a QUEUED trailing rebuild, not just the in-flight one', async () => {
    const h = serialHarness()
    const p1 = h.svc.rebuild()
    const p2 = h.svc.rebuild() // queued: already past captureInFlight's guard
    await flush()

    // Key capture closes the session so the pressed key cannot fire an action.
    // Awaiting only the in-flight rebuild returns while the queued one is
    // still about to install a session underneath the capture probe.
    const closed = h.svc.close()
    h.gates[0]()
    await flush()
    h.gates[1]?.()
    await Promise.all([p1, p2])
    await closed
    await flush()

    expect([...h.live]).toEqual([])
  })
})
