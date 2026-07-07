import { describe, it, expect } from 'vitest'
import { findGw2Pid, readIdentity, type MumbleDeps } from '../src/mumble-reader.js'

const IDENTITY = '{"name":"Not Haro","profession":7,"spec":73,"race":4,"map_id":95,"world_id":2147483650,"commander":true}'

// Build a fake LinkedMem buffer with the real offsets.
function linkedMem(tick: number, name: string, identity: string): Buffer {
  const buf = Buffer.alloc(2048)
  buf.writeUInt32LE(1, 0)        // version
  buf.writeUInt32LE(tick, 4)     // tick
  buf.write(name, 44, 'utf16le')
  buf.write(identity, 592, 'utf16le')
  return buf
}

const MAPS = [
  'aaaa0000-aaaa1000 rw-s 00000000 00:1b 1 /tmp/.wine-1000/server-1/tmpmap-static',
  'bbbb0000-bbbb1000 rw-s 00000000 00:1b 2 /tmp/.wine-1000/server-1/tmpmap-live',
  'cccc0000-ccce0000 rw-s 00000000 00:1b 3 /tmp/.wine-1000/server-1/tmpmap-toobig', // > 64k
  'dddd0000-dddd1000 r--p 00000000 00:1b 4 /some/file',                              // not shared-writable
].join('\n')

function deps(over: Partial<MumbleDeps> = {}): MumbleDeps {
  const live = linkedMem(100, 'Guild Wars 2', IDENTITY)
  let liveTick = 100
  return {
    listPids: () => [10, 4242, 99],
    readProc: (p) => {
      if (p === '/proc/4242/comm') return 'Gw2-64.exe\n'
      if (p === '/proc/10/comm') return 'reaper\n'
      if (p === '/proc/99/comm') return 'srt-bwrap\n'
      if (p === '/proc/4242/maps') return MAPS
      return ''
    },
    readMem: (pid, addr, len) => {
      // 0xbbbb0000 is the live range; its tick increments each read of offset+4
      const base = 0xbbbb0000
      if (pid === 4242 && addr >= base && addr < base + 0x1000) {
        if (addr === base + 4 && len === 4) { const b = Buffer.alloc(4); b.writeUInt32LE(++liveTick, 0); return b }
        return live.subarray(addr - base, addr - base + len)
      }
      // static range 0xaaaa0000 returns a fixed non-ticking, non-GW2 block
      if (pid === 4242 && addr >= 0xaaaa0000 && addr < 0xaaaa1000) return Buffer.alloc(len)
      return null
    },
    ...over,
  }
}

describe('findGw2Pid', () => {
  it('returns the pid whose comm is exactly Gw2-64.exe', () => {
    expect(findGw2Pid(deps())).toBe(4242)
  })
  it('null when no GW2 process', () => {
    expect(findGw2Pid(deps({ readProc: () => 'bash\n' }))).toBeNull()
  })
})

describe('readIdentity', () => {
  it('decodes the identity from the ticking range', () => {
    const id = readIdentity(deps())
    expect(id).toEqual({ character: 'Not Haro', profession: 7, spec: 73, race: 4, mapId: 95, commander: true })
  })
  it('null when GW2 is not running', () => {
    expect(readIdentity(deps({ listPids: () => [10] }))).toBeNull()
  })
  it('null when memory reads fail', () => {
    expect(readIdentity(deps({ readMem: () => null }))).toBeNull()
  })
  it('null when the identity window is not valid JSON', () => {
    const d = deps()
    const orig = d.readMem
    d.readMem = (pid, addr, len) => {
      if (addr >= 0xbbbb0000 + 592 && addr < 0xbbbb0000 + 592 + 512) return Buffer.from('not json~~', 'utf16le')
      return orig(pid, addr, len)
    }
    expect(readIdentity(d)).toBeNull()
  })
})
