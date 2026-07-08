import { readdirSync, openSync, closeSync, readSync, constants } from 'node:fs'
import { keyName, MODIFIER_CODES, type PttBinding, type PttCaptureResult } from '../shared/keys.js'

/** 64-bit input_event: 16 bytes timeval (skipped), u16 type, u16 code,
 *  s32 value — little-endian. */
const FRAME = 24
const KEY_ESC = 1
const BTN_LEFT = 272
const BTN_RIGHT = 273
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

/** Poll-based evdev reader. fs.createReadStream's blocking reads ride
 *  libuv's 4-thread pool — 40+ never-returning device reads starve it and
 *  every stream goes silent (PTT dead once the pass-through unlock makes
 *  all /dev/input nodes readable). Non-blocking opens + a 25 ms readSync
 *  sweep never touch the pool. */
export function pollStream(path: string, intervalMs = 25): { on(ev: 'data' | 'error', cb: (arg: never) => void): void; destroy(): void } {
  let onData: ((b: Buffer) => void) | null = null
  let onError: ((e: Error) => void) | null = null
  let fd = -1
  let openErr: Error | null = null
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK) } catch (e) { openErr = e as Error }
  const buf = Buffer.alloc(FRAME * 64)
  const destroy = () => {
    if (timer) clearInterval(timer)
    if (fd >= 0) { try { closeSync(fd) } catch { /* ignore */ } }
    fd = -1
  }
  const timer = openErr ? null : setInterval(() => {
    for (;;) {
      let n: number
      try { n = readSync(fd, buf, 0, buf.length, null) } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EAGAIN') return
        destroy()
        onError?.(e as Error)  // e.g. ENODEV on unplug — bind prunes, capture's timeout covers
        return
      }
      if (n <= 0) return
      onData?.(Buffer.from(buf.subarray(0, n)))
      if (n < buf.length) return  // drained
    }
  }, intervalMs)
  return {
    on: (ev, cb) => {
      if (ev === 'data') { onData = cb as never; return }
      onError = cb as never
      if (openErr) queueMicrotask(() => onError?.(openErr as Error))
    },
    destroy,
  }
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
  openStream: (path) => pollStream(path) as never,
}

/** Observational PTT capture: reads every readable /dev/input/event* and
 *  watches for the configured binding's edges; an optional modifier gates
 *  activation. Nothing is grabbed or consumed — Discord's own PTT (and
 *  everything else) still receives the key. Non-keyboards simply never emit
 *  the bound code. */
export function createEvdevShortcuts(deps: EvdevDeps = realDeps) {
  return {
    async available(): Promise<boolean> {
      return deps.listDevices().some((d) => deps.canRead(d))
    },

    async bind(_id: string, _description: string, binding: PttBinding): Promise<BoundShortcut> {
      const { key, modifier } = binding
      const modCodes = modifier ? MODIFIER_CODES[modifier] : null
      const readable = deps.listDevices().filter((d) => deps.canRead(d))
      if (readable.length === 0) throw new Error('no readable input devices — pass-through is locked')
      let onAct: (() => void) | null = null
      let onDeact: (() => void) | null = null
      // modifier + active state are shared across ALL device streams — the
      // modifier can come from the keyboard while the key comes from the
      // mouse. A modifier already held before arming isn't seen until its
      // next edge (accepted: worst case is one missed activation).
      let modifierHeld = false
      let active = false
      const streams = new Set<ReturnType<EvdevDeps['openStream']>>()
      readable.forEach((path) => {
        const stream = deps.openStream(path)
        streams.add(stream)
        let rest: Buffer = Buffer.alloc(0)
        stream.on('data', ((chunk: Buffer) => {
          const parsed = parseInputEvents(rest.length === 0 ? chunk : Buffer.concat([rest, chunk]))
          rest = parsed.rest
          for (const ev of parsed.events) {
            if (ev.type !== EV_KEY) continue
            if (modCodes && (ev.code === modCodes[0] || ev.code === modCodes[1])) {
              if (ev.value === 1) modifierHeld = true
              else if (ev.value === 0) {
                modifierHeld = false
                if (active) { active = false; onDeact?.() }
              }
              continue
            }
            if (ev.code !== key.code) continue
            if (ev.value === 1) {
              if ((!modCodes || modifierHeld) && !active) { active = true; onAct?.() }
            } else if (ev.value === 0) {
              if (active) { active = false; onDeact?.() }
            }
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
 *  UX. Escape cancels; plain clicks are skipped (the Rebind click itself
 *  must never bind BTN_LEFT); the timeout and no-device cases report
 *  themselves so the UI can say what happened. All probe streams are
 *  destroyed on settle. */
export function captureNextKey(deps: EvdevDeps = realDeps, timeoutMs = 10000): Promise<PttCaptureResult> {
  return new Promise((resolve) => {
    const readable = deps.listDevices().filter((d) => deps.canRead(d))
    if (readable.length === 0) { resolve({ reason: 'unavailable' }); return }
    const streams: { destroy(): void }[] = []
    let done = false
    const settle = (result: PttCaptureResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      for (const s of streams) { try { s.destroy() } catch { /* ignore */ } }
      resolve(result)
    }
    const timer = setTimeout(() => settle({ reason: 'timeout' }), timeoutMs)
    for (const path of readable) {
      const stream = deps.openStream(path)
      streams.push(stream)
      let rest: Buffer = Buffer.alloc(0)
      stream.on('data', ((chunk: Buffer) => {
        const parsed = parseInputEvents(rest.length === 0 ? chunk : Buffer.concat([rest, chunk]))
        rest = parsed.rest
        for (const ev of parsed.events) {
          if (ev.type !== EV_KEY || ev.value !== 1) continue
          if (ev.code === KEY_ESC) { settle({ reason: 'cancelled' }); return }
          if (ev.code === BTN_LEFT || ev.code === BTN_RIGHT) continue
          // Accept ANY other key — "press any key" means what it says.
          // Off-table keys keep their code with a KEY_<n> name.
          settle({ key: { code: ev.code, name: keyName(ev.code) } })
          return
        }
      }) as never)
      stream.on('error', (() => { /* dead probe stream — timeout covers it */ }) as never)
    }
  })
}
