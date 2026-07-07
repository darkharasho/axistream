export interface MumbleIdentity {
  character: string; profession: number; spec: number; race: number; mapId: number; commander: boolean
}
export interface MumbleDeps {
  readProc(path: string): string
  listPids(): number[]
  readMem(pid: number, addr: number, len: number): Buffer | null
}

const GW2_COMM = 'Gw2-64.exe'
const IDENTITY_OFFSET = 592
const IDENTITY_LEN = 512
const TICK_OFFSET = 4

export function findGw2Pid(d: MumbleDeps): number | null {
  for (const pid of d.listPids()) {
    try { if (d.readProc(`/proc/${pid}/comm`).trim() === GW2_COMM) return pid }
    catch { /* pid vanished */ }
  }
  return null
}

function candidateRanges(maps: string): number[] {
  const out: number[] = []
  for (const line of maps.split('\n')) {
    if (!line.includes('tmpmap-') || !line.includes(' rw-s ')) continue
    const [range] = line.split(' ')
    const [s, e] = range.split('-').map((x) => parseInt(x, 16))
    if (Number.isFinite(s) && Number.isFinite(e) && e - s <= 65536) out.push(s)
  }
  return out
}

function parseIdentityBuf(buf: Buffer): MumbleIdentity | null {
  try {
    const json = buf.toString('utf16le').split('\0')[0]
    if (!json) return null
    const o = JSON.parse(json)
    if (typeof o.name !== 'string') return null
    return {
      character: o.name, profession: Number(o.profession) || 0, spec: Number(o.spec) || 0,
      race: Number(o.race) || 0, mapId: Number(o.map_id) || 0, commander: !!o.commander,
    }
  } catch { return null }
}

/** Read GW2's MumbleLink identity from shared memory. Best-effort — returns
 *  null if GW2 isn't running, isn't in a map, or anything fails. */
export function readIdentity(d: MumbleDeps): MumbleIdentity | null {
  const pid = findGw2Pid(d)
  if (pid === null) return null
  let maps: string
  try { maps = d.readProc(`/proc/${pid}/maps`) } catch { return null }
  const ranges = candidateRanges(maps)
  // Prefer a range whose tick changes across two reads (the live block).
  let chosen: number | null = null
  for (const start of ranges) {
    const t1 = d.readMem(pid, start + TICK_OFFSET, 4)
    const t2 = d.readMem(pid, start + TICK_OFFSET, 4)
    if (t1 && t2 && t1.readUInt32LE(0) !== t2.readUInt32LE(0)) { chosen = start; break }
  }
  // Fallback: first range that yields a parseable identity.
  // Try the ticking range first, then the rest — a non-MumbleLink block that
  // happens to tick shouldn't strand the real one (it won't parse as identity).
  const tryOrder = chosen !== null ? [chosen, ...ranges.filter((r) => r !== chosen)] : ranges
  for (const start of tryOrder) {
    const buf = d.readMem(pid, start + IDENTITY_OFFSET, IDENTITY_LEN)
    if (!buf) continue
    const id = parseIdentityBuf(buf)
    if (id) return id
  }
  return null
}
