// packages/app/test/hotkey-serialization.test.ts
// One watcher per backend is the invariant HotkeyService exists to hold.
// close() nulls `this.set` synchronously, so two overlapping rebuilds used to
// interleave into two live sessions and the loser's watcher leaked for the
// process lifetime — N leaked evdev pollers over ~40 device nodes is the
// libuv thread-pool starvation that broke push-to-talk in v0.1.6. Two paths
// reach rebuild() concurrently in the real app: the detached boot rebuild
// (whose portal BindShortcuts can sit on an interactive approval dialog for a
// minute) and a plain settings double-click, since ipcMain.handle is not
// serialized.
import { describe, it, expect, vi } from 'vitest'
import { HotkeyService } from '../src/main/HotkeyService.js'

const F13 = { code: 183, name: 'F13' }
const flush = () => new Promise((r) => setImmediate(r))

function serialHarness() {
  const events: string[] = []
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
          events.push(`bind:start:${id}`)
          // Deferred: the session does not become live until the test says so.
          await new Promise<void>((resolve) => { gates.push(resolve) })
          events.push(`bind:done:${id}`)
          live.add(id)
          maxLive = Math.max(maxLive, live.size)
          return {
            onActivated() {},
            onDeactivated() {},
            close: async () => { events.push(`close:${id}`); live.delete(id) },
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
  return { svc, events, gates, live, calls: () => n, maxLive: () => maxLive }
}

describe('rebuild serialization', () => {
  it('never runs two bindAll sessions at once — the second waits for the first to close', async () => {
    const h = serialHarness()
    const p1 = h.svc.rebuild()
    const p2 = h.svc.rebuild()
    await flush()

    // The second entrant has NOT started binding while the first is in flight.
    expect(h.calls()).toBe(1)

    h.gates[0]()
    await p1
    await flush()
    expect(h.calls()).toBe(2)

    h.gates[1]()
    await p2
    await flush()

    expect(h.events).toEqual([
      'bind:start:1', 'bind:done:1', 'close:1', 'bind:start:2', 'bind:done:2',
    ])
    expect(h.maxLive()).toBe(1)
    expect([...h.live]).toEqual([2])
  })

  it('coalesces a burst of requests into ONE trailing rebuild, not a queue', async () => {
    const h = serialHarness()
    const ps = [h.svc.rebuild(), h.svc.rebuild(), h.svc.rebuild(), h.svc.rebuild(), h.svc.rebuild()]
    await flush()
    expect(h.calls()).toBe(1)

    h.gates[0]()
    await flush()
    expect(h.calls()).toBe(2)

    h.gates[1]()
    await Promise.all(ps)
    await flush()

    // Five rapid clicks cost two rebuilds: the in-flight one plus one trailing.
    expect(h.calls()).toBe(2)
    expect(h.maxLive()).toBe(1)
  })

  it('every coalesced caller observes the trailing rebuild result', async () => {
    const h = serialHarness()
    const p1 = h.svc.rebuild()
    const p2 = h.svc.rebuild()
    const p3 = h.svc.rebuild()
    await flush()
    h.gates[0]()
    await flush()
    h.gates[1]()

    expect((await p1).ok).toBe(true)
    expect((await p2).ok).toBe(true)
    expect((await p3).ok).toBe(true)
    expect(h.calls()).toBe(2)
  })

  it('a failing rebuild still releases the lock for the next one', async () => {
    let fail = true
    const svc = new HotkeyService({
      selectBackend: async () => ({
        backend: {
          available: async () => true,
          bindAll: async () => {
            if (fail) throw new Error('portal denied')
            return { onActivated() {}, onDeactivated() {}, close: async () => {} }
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

    expect((await svc.rebuild()).ok).toBe(false)
    fail = false
    expect((await svc.rebuild()).ok).toBe(true)
  })
})

describe('ptt edge error boundary', () => {
  it('does not let a throwing onPttEdge escape the backend callback', async () => {
    let activated: ((id: string) => void) | null = null
    let deactivated: ((id: string) => void) | null = null
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const svc = new HotkeyService({
      selectBackend: async () => ({
        backend: {
          available: async () => true,
          bindAll: async () => ({
            onActivated(cb: (id: string) => void) { activated = cb },
            onDeactivated(cb: (id: string) => void) { deactivated = cb },
            close: async () => {},
          }),
        },
        mode: 'passthrough',
      }),
      bindings: () => ({ goLive: null, micMute: null, masks: null, record: null }),
      pttBinding: () => ({ key: { code: 188, name: 'F18' }, modifier: null }),
      actions: {} as never,
      onPttEdge: () => { throw new Error('pactl is gone') },
      onMode: () => {},
      now: () => 0,
    })
    await svc.rebuild()

    // These fire from an evdev stream `data` handler, a Windows timer tick or
    // a D-Bus signal handler — a throw there takes down main with no renderer
    // left to report it.
    expect(() => activated!('ptt')).not.toThrow()
    expect(() => deactivated!('ptt')).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('close during an in-flight rebuild', () => {
  it('waits for the rebuild, then leaves NO session live', async () => {
    const h = serialHarness()
    const p = h.svc.rebuild()
    // The key-capture flow closes the session so the pressed key cannot fire
    // an action. Closing ahead of a rebuild that is about to install a fresh
    // session would leave one live underneath it.
    const closed = h.svc.close()
    await flush()
    h.gates[0]()
    await p
    await closed
    await flush()

    expect(h.calls()).toBe(1)
    expect([...h.live]).toEqual([])
    expect(h.events).toEqual(['bind:start:1', 'bind:done:1', 'close:1'])
  })
})
