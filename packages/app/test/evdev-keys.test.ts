import { describe, it, expect, vi } from 'vitest'
import { parseInputEvents, createEvdevShortcuts, captureNextKey } from '../src/main/evdev-keys.js'

const KEY_F18 = 188

function frame(type: number, code: number, value: number): Buffer {
  const b = Buffer.alloc(24)
  b.writeUInt16LE(type, 16)
  b.writeUInt16LE(code, 18)
  b.writeInt32LE(value, 20)
  return b
}

describe('parseInputEvents', () => {
  it('parses whole frames and returns an empty remainder', () => {
    const buf = Buffer.concat([frame(1, KEY_F18, 1), frame(1, KEY_F18, 0)])
    const { events, rest } = parseInputEvents(buf)
    expect(events).toEqual([
      { type: 1, code: KEY_F18, value: 1 },
      { type: 1, code: KEY_F18, value: 0 },
    ])
    expect(rest.length).toBe(0)
  })

  it('carries a partial trailing frame as the remainder', () => {
    const buf = Buffer.concat([frame(1, KEY_F18, 1), frame(1, 30, 1).subarray(0, 10)])
    const { events, rest } = parseInputEvents(buf)
    expect(events).toHaveLength(1)
    expect(rest.length).toBe(10)
  })

  it('handles an empty buffer', () => {
    const { events, rest } = parseInputEvents(Buffer.alloc(0))
    expect(events).toEqual([])
    expect(rest.length).toBe(0)
  })
})

type Handler = (arg: unknown) => void
function fakeDevice() {
  const handlers: Record<string, Handler[]> = { data: [], error: [] }
  return {
    stream: {
      on: (ev: string, cb: Handler) => { handlers[ev].push(cb) },
      destroy: vi.fn(),
    },
    emitData: (b: Buffer) => handlers.data.forEach((cb) => cb(b)),
    emitError: (e: Error) => handlers.error.forEach((cb) => cb(e)),
  }
}

describe('createEvdevShortcuts', () => {
  function harness(readable = true) {
    const devs = { '/dev/input/event3': fakeDevice(), '/dev/input/event7': fakeDevice() }
    const backend = createEvdevShortcuts({
      listDevices: () => Object.keys(devs),
      canRead: () => readable,
      openStream: (p) => devs[p as keyof typeof devs].stream as never,
    })
    return { backend, devs }
  }

  it('available() reflects device readability', async () => {
    expect(await harness(true).backend.available()).toBe(true)
    expect(await harness(false).backend.available()).toBe(false)
  })

  it('fires activated/deactivated for F18 press/release; ignores repeats and other codes', async () => {
    const h = harness()
    const sc = await h.backend.bind('ptt', 'Push to talk', { code: KEY_F18, name: 'F18' })
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    sc.onDeactivated(() => seq.push('up'))
    const dev = h.devs['/dev/input/event3']
    dev.emitData(frame(1, KEY_F18, 1))
    dev.emitData(frame(1, KEY_F18, 2))   // repeat — ignored
    dev.emitData(frame(1, 30, 1))        // KEY_A — ignored
    dev.emitData(frame(1, KEY_F18, 0))
    expect(seq).toEqual(['down', 'up'])
  })

  it('reassembles frames split across reads', async () => {
    const h = harness()
    const sc = await h.backend.bind('ptt', 'Push to talk', { code: KEY_F18, name: 'F18' })
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    const f = frame(1, KEY_F18, 1)
    const dev = h.devs['/dev/input/event7']
    dev.emitData(f.subarray(0, 11))
    dev.emitData(f.subarray(11))
    expect(seq).toEqual(['down'])
  })

  it('a device stream error drops that device without throwing; close destroys all streams', async () => {
    const h = harness()
    const sc = await h.backend.bind('ptt', 'Push to talk', { code: KEY_F18, name: 'F18' })
    h.devs['/dev/input/event3'].emitError(new Error('unplugged'))
    await sc.close()
    expect(h.devs['/dev/input/event7'].stream.destroy).toHaveBeenCalled()
  })

  it('bind rejects when nothing is readable', async () => {
    const h = harness(false)
    await expect(h.backend.bind('ptt', 'Push to talk', { code: KEY_F18, name: 'F18' })).rejects.toThrow(/no readable input devices/i)
  })
})

describe('createEvdevShortcuts key parameter', () => {
  it('filters on the PASSED code, not 188', async () => {
    const devs = { '/dev/input/event3': fakeDevice(), '/dev/input/event7': fakeDevice() }
    const backend = createEvdevShortcuts({
      listDevices: () => Object.keys(devs),
      canRead: () => true,
      openStream: (p) => devs[p as keyof typeof devs].stream as never,
    })
    const sc = await backend.bind('ptt', 'Push to talk', { code: 185, name: 'F15' })
    const seq: string[] = []
    sc.onActivated(() => seq.push('down'))
    const dev = devs['/dev/input/event3']
    dev.emitData(frame(1, KEY_F18, 1))   // old key — must NOT fire
    dev.emitData(frame(1, 185, 1))
    expect(seq).toEqual(['down'])
  })
})

describe('captureNextKey', () => {
  function capHarness() {
    const devs = { '/dev/input/event3': fakeDevice() }
    return { devs, deps: {
      listDevices: () => Object.keys(devs),
      canRead: () => true,
      openStream: (p: string) => devs[p as keyof typeof devs].stream as never,
    } }
  }
  it('resolves with the first keydown, named from the table', async () => {
    const h = capHarness()
    const p = captureNextKey(h.deps, 5000)
    h.devs['/dev/input/event3'].emitData(frame(1, 185, 1))
    expect(await p).toEqual({ code: 185, name: 'F15' })
    expect(h.devs['/dev/input/event3'].stream.destroy).toHaveBeenCalled()
  })
  it('ignores releases and non-key events; Escape cancels with null', async () => {
    const h = capHarness()
    const p = captureNextKey(h.deps, 5000)
    const dev = h.devs['/dev/input/event3']
    dev.emitData(frame(1, 185, 0))  // release — ignored
    dev.emitData(frame(2, 0, 1))    // EV_REL — ignored
    dev.emitData(frame(1, 1, 1))    // Escape — cancel
    expect(await p).toBeNull()
  })
  it('times out to null', async () => {
    const h = capHarness()
    expect(await captureNextKey(h.deps, 10)).toBeNull()
  })
})

describe('captureNextKey accepts any key', () => {
  it('captures an off-table key with a KEY_<n> name', async () => {
    const devs = { '/dev/input/event3': fakeDevice() }
    const p = captureNextKey({
      listDevices: () => Object.keys(devs),
      canRead: () => true,
      openStream: (d: string) => devs[d as keyof typeof devs].stream as never,
    }, 5000)
    devs['/dev/input/event3'].emitData(frame(1, 275, 1))  // BTN_SIDE — off-table
    expect(await p).toEqual({ code: 275, name: 'KEY_275' })
  })
})
