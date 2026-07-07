import { readdirSync, openSync, closeSync, createReadStream } from 'node:fs'

/** 64-bit input_event: 16 bytes timeval (skipped), u16 type, u16 code,
 *  s32 value — little-endian. */
const FRAME = 24
export const KEY_F18 = 188
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
  openStream: (path) => createReadStream(path) as never,
}

/** Observational PTT capture: reads every readable /dev/input/event* and
 *  watches for KEY_F18 edges. Nothing is grabbed or consumed — Discord's own
 *  PTT (and everything else) still receives the key. Non-keyboards simply
 *  never emit code 188. */
export function createEvdevShortcuts(deps: EvdevDeps = realDeps) {
  return {
    async available(): Promise<boolean> {
      return deps.listDevices().some((d) => deps.canRead(d))
    },

    async bind(_id: string, _description: string, _preferredTrigger: string): Promise<BoundShortcut> {
      const readable = deps.listDevices().filter((d) => deps.canRead(d))
      if (readable.length === 0) throw new Error('no readable input devices — pass-through is locked')
      let onAct: (() => void) | null = null
      let onDeact: (() => void) | null = null
      const streams = readable.map((path) => {
        const stream = deps.openStream(path)
        let rest: Buffer = Buffer.alloc(0)
        stream.on('data', ((chunk: Buffer) => {
          const parsed = parseInputEvents(Buffer.concat([rest, chunk]))
          rest = parsed.rest
          for (const ev of parsed.events) {
            if (ev.type !== EV_KEY || ev.code !== KEY_F18) continue
            if (ev.value === 1) onAct?.()
            else if (ev.value === 0) onDeact?.()
            // value 2 = auto-repeat: ignored (the key is already down)
          }
        }) as never)
        stream.on('error', ((e: Error) => {
          console.warn(`[ptt] evdev device dropped (${path}):`, e.message)
        }) as never)
        return stream
      })
      return {
        onActivated: (cb) => { onAct = cb },
        onDeactivated: (cb) => { onDeact = cb },
        close: async () => { for (const s of streams) { try { s.destroy() } catch { /* ignore */ } } },
      }
    },
  }
}
