import { describe, it, expect, vi } from 'vitest'
import { identityFromBlock, LINKED_MEM_SIZE } from '../src/mumble-reader.js'
import { readIdentityWindows, MUMBLE_MAP_NAME, type WindowsMumbleDeps } from '../src/mumble-windows.js'
import { readGw2Identity } from '../src/mumble-select.js'

const IDENTITY = '{"name":"Not Haro","profession":7,"spec":73,"race":4,"map_id":95,"team_color_id":376,"commander":true}'

function block(identity = IDENTITY, size = LINKED_MEM_SIZE): Buffer {
  const buf = Buffer.alloc(size)
  buf.writeUInt32LE(2, 0)
  buf.writeUInt32LE(1234, 4)
  buf.write('Guild Wars 2', 44, 'utf16le')
  if (identity) buf.write(identity, 592, 'utf16le')
  return buf
}

// The one fallible step both platforms share.
describe('identityFromBlock', () => {
  it('decodes a populated block', () => {
    expect(identityFromBlock(block())).toEqual({
      character: 'Not Haro', profession: 7, spec: 73, race: 4, mapId: 95, commander: true, teamColorId: 376,
    })
  })

  it('returns null for a zeroed block (GW2 on character select)', () => {
    expect(identityFromBlock(Buffer.alloc(LINKED_MEM_SIZE))).toBeNull()
  })

  it('returns null for a block too short to hold the identity', () => {
    expect(identityFromBlock(Buffer.alloc(400))).toBeNull()
  })

  it('returns null for non-JSON and for JSON without a name', () => {
    expect(identityFromBlock(block('not json at all'))).toBeNull()
    expect(identityFromBlock(block('{"profession":7}'))).toBeNull()
  })
})

describe('readIdentityWindows', () => {
  const deps = (mapBlock: WindowsMumbleDeps['mapBlock']): WindowsMumbleDeps => ({ mapBlock })

  it('maps the MumbleLink block and parses it', () => {
    const mapBlock = vi.fn().mockReturnValue(block())
    expect(readIdentityWindows(deps(mapBlock))?.character).toBe('Not Haro')
    expect(mapBlock).toHaveBeenCalledWith(MUMBLE_MAP_NAME, LINKED_MEM_SIZE)
  })

  it('returns null when the mapping is absent (GW2 not running)', () => {
    expect(readIdentityWindows(deps(() => null))).toBeNull()
  })

  it('returns null on a short buffer', () => {
    expect(readIdentityWindows(deps(() => Buffer.alloc(64)))).toBeNull()
  })

  // koffi may be missing or kernel32 may throw; a title variable is not worth
  // taking go-live down for.
  it('swallows a throwing mapBlock', () => {
    expect(readIdentityWindows(deps(() => { throw new Error('koffi unavailable') }))).toBeNull()
  })
})

describe('readGw2Identity', () => {
  const linux = { readProc: () => '', listPids: () => [], readMem: () => null }
  const windows = { mapBlock: () => block() }

  it('uses the named-mapping reader on win32', () => {
    expect(readGw2Identity({ platform: 'win32', linux, windows })?.character).toBe('Not Haro')
  })

  it('uses the /proc reader elsewhere', () => {
    // The linux deps above find no GW2 pid, so a win32 result here would mean
    // the arms are crossed.
    expect(readGw2Identity({ platform: 'linux', linux, windows })).toBeNull()
  })
})
