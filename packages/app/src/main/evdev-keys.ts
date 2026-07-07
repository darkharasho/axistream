import { readdirSync, openSync, closeSync, createReadStream } from 'node:fs'
import { keyName, isKnownKey, type PttKey } from '../shared/keys.js'

/** 64-bit input_event: 16 bytes timeval (skipped), u16 type, u16 code,
 *  s32 value — little-endian. */
const FRAME = 24
const KEY_ESC = 1
const EV_KEY = 1

export interface InputEvent { type: number; code: number; value: number }

export function parseInputEvents(buf: Buffer): { events: InputEvent[]; rest: Buffer } {
  const events: InputEvent[] = []
  let off = 0
  while (off + FRAME <= buf.length) {
    events.push({
      type: buf.readUInt16LE(off + 16),
      code: buf.readUInt16LE(off + 18),
      value: buf.readInt32LE(off + 20),
    })
    off += FRAME
  }
  return { events, rest: buf.subarray(off) }
}

// Same shape as portal-shortcuts' BoundShortcut — structural on purpose so
// PttController accepts either backend unchanged.
export interface BoundShortcut { onActivated(cb: () => void): void; onDeactivated(cb: () => void): void; close(): Promise<void> }

export interface EvdevDeps {
  listDevices(): string[]
  canRead(path: string): boolean
  openStream(path: string): { on(ev: 'data' | 'error', cb: (arg: never) => void): void; destroy(): void }
}

const realDeps: EvdevDeps = {
  listDevices: () => {
    try {
      return readdirSync('/dev/input').filter((f) => f.startsWith('event')).map((f) => `/dev/input/${f}`)
    } catch { return [] }
  },
  canRead: (path) => {
    try { closeSync(openSync(path, 'r')); return true } catch { return false }
  },
  // fs.ReadStream's event overloads don't structurally match the narrow
  // EvdevDeps shape — the cast is interface-narrowing, not type-punning.
  openStream: (path) => createReadStream(path) as never,
}

/** Observational PTT capture: reads every readable /dev/input/event* and
 *  watches for the configured key's edges. Nothing is grabbed or consumed —
 *  Discord's own PTT (and everything else) still receives the key.
 *  Non-keyboards simply never emit the bound code. */
export function createEvdevShortcuts(deps: EvdevDeps = realDeps) {
  return {
    async available(): Promise<boolean> {
      return deps.listDevices().some((d) => deps.canRead(d))
    },

    async bind(_id: string, _description: string, key: PttKey): Promise<BoundShortcut> {
      const readable = deps.listDevices().filter((d) => deps.canRead(d))
      if (readable.length === 0) throw new Error('no readable input devices — pass-through is locked')
      let onAct: (() => void) | null = null
      let onDeact: (() => void) | null = null
      const streams = new Set<ReturnType<EvdevDeps['openStream']>>()
      readable.forEach((path) => {
        const stream = deps.openStream(path)
        streams.add(stream)
        let rest: Buffer = Buffer.alloc(0)
        stream.on('data', ((chunk: Buffer) => {
          // fast path: mice flood EV_REL frames — skip the concat allocation
          // unless a previous read left a partial frame
          const parsed = parseInputEvents(rest.length === 0 ? chunk : Buffer.concat([rest, chunk]))
          rest = parsed.rest
          for (const ev of parsed.events) {
            if (ev.type !== EV_KEY || ev.code !== key.code) continue
            if (ev.value === 1) onAct?.()
            else if (ev.value === 0) onDeact?.()
            // value 2 = auto-repeat: ignored (the key is already down)
          }
        }) as never)
        stream.on('error', ((e: Error) => {
          console.warn(`[ptt] evdev device dropped (${path}):`, e.message)
          streams.delete(stream)
          try { stream.destroy() } catch { /* ignore */ }
        }) as never)
      })
      return {
        onActivated: (cb) => { onAct = cb },
        onDeactivated: (cb) => { onDeact = cb },
        close: async () => { for (const s of streams) { try { s.destroy() } catch { /* ignore */ } } },
      }
    },
  }
}

/** Resolve the next keydown seen on any readable device — the press-to-bind
 *  UX. Escape cancels; timeout returns null. All probe streams are destroyed
 *  on settle. */
export function captureNextKey(deps: EvdevDeps = realDeps, timeoutMs = 10000): Promise<PttKey | null> {
  return new Promise((resolve) => {
    const readable = deps.listDevices().filter((d) => deps.canRead(d))
    if (readable.length === 0) { resolve(null); return }
    const streams: { destroy(): void }[] = []
    let done = false
    const settle = (result: PttKey | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      for (const s of streams) { try { s.destroy() } catch { /* ignore */ } }
      resolve(result)
    }
    const timer = setTimeout(() => settle(null), timeoutMs)
    for (const path of readable) {
      const stream = deps.openStream(path)
      streams.push(stream)
      let rest: Buffer = Buffer.alloc(0)
      stream.on('data', ((chunk: Buffer) => {
        const parsed = parseInputEvents(rest.length === 0 ? chunk : Buffer.concat([rest, chunk]))
        rest = parsed.rest
        for (const ev of parsed.events) {
          if (ev.type !== EV_KEY || ev.value !== 1) continue
          if (ev.code === KEY_ESC) { settle(null); return }
          // off-table keys (mouse buttons etc.) keep listening — binding one
          // would desync the exclusive dropdown and produce phantom portal hints
          if (!isKnownKey(ev.code)) continue
          settle({ code: ev.code, name: keyName(ev.code) })
          return
        }
      }) as never)
      stream.on('error', (() => { /* dead probe stream — timeout covers it */ }) as never)
    }
  })
}
