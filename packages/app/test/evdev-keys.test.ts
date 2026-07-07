import { describe, it, expect, vi } from 'vitest'
import { parseInputEvents, createEvdevShortcuts, KEY_F18 } from '../src/main/evdev-keys.js'

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
    const sc = await h.backend.bind('ptt', 'Push to talk', 'F18')
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
    const sc = await h.backend.bind('ptt', 'Push to talk', 'F18')
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
    const sc = await h.backend.bind('ptt', 'Push to talk', 'F18')
    h.devs['/dev/input/event3'].emitError(new Error('unplugged'))
    await sc.close()
    expect(h.devs['/dev/input/event7'].stream.destroy).toHaveBeenCalled()
  })

  it('bind rejects when nothing is readable', async () => {
    const h = harness(false)
    await expect(h.backend.bind('ptt', 'Push to talk', 'F18')).rejects.toThrow(/no readable input devices/i)
  })
})
