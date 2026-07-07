# GW2 MumbleLink Title Variables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New title-template variables `{{character}}`, `{{class}}`, `{{map}}`, `{{race}}` resolved from GW2's MumbleLink shared memory at go-live.

**Architecture:** A best-effort `mumble-reader` (capture pkg) reads the block via `/proc/<pid>/mem` (verified no-native-addon); pure `gw2-names` tables + memoized GW2 API lookups; `TitleTemplate` gains four vars fed by a pre-resolved `gw2` context; the go-live handler resolves under a bounded timeout. Spec: `docs/superpowers/specs/2026-07-06-mumble-title-vars-design.md` (memory layout + identity JSON are live-spike ground truth).

**Tech Stack:** Node `fs` (`/proc/<pid>/mem`), native `fetch`, TypeScript 5.5, Vitest 2.

## Global Constraints

- No new dependencies; 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on relative imports.
- MumbleLink layout (LE): tick `u32 @4`; name `wchar[256] @44`; identity `wchar[256] @592` (UTF-16LE JSON). GW2 pid = the `/proc/<pid>/comm` that trims to exactly `Gw2-64.exe`. Candidate ranges: `/proc/<pid>/maps` lines with `rw-s` AND `tmpmap-` AND size ≤ 65536; pick the one whose tick changes across a re-read (else first parseable).
- Profession 1..9: Guardian, Warrior, Engineer, Ranger, Thief, Elementalist, Mesmer, Necromancer, Revenant. Race 1..5: Asura, Charr, Human, Norn, Sylvari. Out-of-range → ''.
- Every layer best-effort — null/'' on failure; nothing blocks or delays go-live beyond a ~1500 ms resolve budget. Non-Linux → readIdentity null.
- `{{class}}` = elite `specName(spec)` if it resolves, else `professionName(profession)`. Map/spec names via memoized `/v2/maps/{id}` and `/v2/specializations/{id}` unauthenticated.
- Gates per task: capture pkg tasks → `npm -w @axistream/capture run test`; app tasks → `npm -w @axistream/app run test`; final: `cd packages/app && npx tsc --noEmit -p tsconfig.json` zero.

---

## File Structure

**New (capture pkg):** `src/mumble-reader.ts`, `src/gw2-names.ts` (+ tests, + `index.ts` exports).
**Modified (app):** `src/main/TitleTemplate.ts` (+ test), `src/main/index.ts`, `src/renderer/components/YouTubeSettings.tsx` (+ test if it has one).

---

### Task 1: gw2-names (pure tables + memoized lookups)

**Files:**
- Create: `packages/capture/src/gw2-names.ts`
- Modify: `packages/capture/src/index.ts` (export)
- Test: `packages/capture/test/gw2-names.test.ts`

**Interfaces:**
- Produces: `professionName(id: number): string`; `raceName(id: number): string`; `mapName(id: number, fetchJson: (url: string) => Promise<any>): Promise<string>`; `specName(id: number, fetchJson: (url: string) => Promise<any>): Promise<string>`.

- [ ] **Step 1: Failing tests** — `packages/capture/test/gw2-names.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { professionName, raceName, mapName, specName } from '../src/gw2-names.js'

describe('static tables', () => {
  it('profession ids map to names; out-of-range is empty', () => {
    expect(professionName(1)).toBe('Guardian')
    expect(professionName(7)).toBe('Mesmer')
    expect(professionName(9)).toBe('Revenant')
    expect(professionName(0)).toBe('')
    expect(professionName(10)).toBe('')
  })
  it('race ids map to names', () => {
    expect(raceName(1)).toBe('Asura')
    expect(raceName(4)).toBe('Norn')
    expect(raceName(6)).toBe('')
  })
})

describe('mapName / specName memoized lookups', () => {
  it('mapName fetches once and memoizes', async () => {
    const fetchJson = vi.fn(async () => ({ name: 'Fractals of the Mists' }))
    expect(await mapName(950001, fetchJson)).toBe('Fractals of the Mists')
    expect(await mapName(950001, fetchJson)).toBe('Fractals of the Mists')
    expect(fetchJson).toHaveBeenCalledTimes(1)
    expect(fetchJson).toHaveBeenCalledWith('https://api.guildwars2.com/v2/maps/950001')
  })
  it('specName fetches the specialization name', async () => {
    const fetchJson = vi.fn(async () => ({ name: 'Chronomancer' }))
    expect(await specName(950002, fetchJson)).toBe('Chronomancer')
    expect(fetchJson).toHaveBeenCalledWith('https://api.guildwars2.com/v2/specializations/950002')
  })
  it('fetch failure yields empty string', async () => {
    const fetchJson = vi.fn(async () => { throw new Error('offline') })
    expect(await mapName(950003, fetchJson)).toBe('')
    expect(await specName(950004, fetchJson)).toBe('')
  })
  it('missing name field yields empty string', async () => {
    const fetchJson = vi.fn(async () => ({}))
    expect(await mapName(950005, fetchJson)).toBe('')
  })
})
```

(Use ids unlikely to collide across tests since the memo cache is module-global; the plan's ids are distinct on purpose.)
- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/capture run test -- test/gw2-names.test.ts` → FAIL.
- [ ] **Step 3: Implement** — `packages/capture/src/gw2-names.ts`:

```ts
const PROFESSIONS = ['', 'Guardian', 'Warrior', 'Engineer', 'Ranger', 'Thief', 'Elementalist', 'Mesmer', 'Necromancer', 'Revenant']
const RACES = ['', 'Asura', 'Charr', 'Human', 'Norn', 'Sylvari']

export function professionName(id: number): string { return PROFESSIONS[id] ?? '' }
export function raceName(id: number): string { return RACES[id] ?? '' }

const mapCache = new Map<number, string>()
const specCache = new Map<number, string>()

async function lookup(cache: Map<number, string>, url: string, id: number, fetchJson: (url: string) => Promise<any>): Promise<string> {
  const hit = cache.get(id)
  if (hit !== undefined) return hit
  try {
    const data = await fetchJson(url)
    const name = typeof data?.name === 'string' ? data.name : ''
    cache.set(id, name)
    return name
  } catch { return '' } // don't cache failures — allow a later retry
}

export function mapName(id: number, fetchJson: (url: string) => Promise<any>): Promise<string> {
  return lookup(mapCache, `https://api.guildwars2.com/v2/maps/${id}`, id, fetchJson)
}
export function specName(id: number, fetchJson: (url: string) => Promise<any>): Promise<string> {
  return lookup(specCache, `https://api.guildwars2.com/v2/specializations/${id}`, id, fetchJson)
}
```

- [ ] **Step 4:** Add `export * from './gw2-names.js'` to `packages/capture/src/index.ts`. Run to verify pass → all green.
- [ ] **Step 5: Commit**

```bash
git add packages/capture/src/gw2-names.ts packages/capture/src/index.ts packages/capture/test/gw2-names.test.ts
git commit -m "feat(gw2): profession/race tables + memoized map/spec name lookups"
```

---

### Task 2: mumble-reader (identity from shared memory)

**Files:**
- Create: `packages/capture/src/mumble-reader.ts`
- Modify: `packages/capture/src/index.ts` (export)
- Test: `packages/capture/test/mumble-reader.test.ts`

**Interfaces:**
- Produces: `interface MumbleIdentity { character: string; profession: number; spec: number; race: number; mapId: number; commander: boolean }`; `interface MumbleDeps { readProc(path: string): string; listPids(): number[]; readMem(pid: number, addr: number, len: number): Buffer | null; probe?: (fn: () => void) => void }`; `findGw2Pid(d: MumbleDeps): number | null`; `readIdentity(d: MumbleDeps): MumbleIdentity | null`.

Note the real `readMem` (a thin `/proc/<pid>/mem` reader) is wired in Task 3 — this task takes it as a dep so it stays testable with a fake memory map. The tick re-read is synchronous in tests (the fake returns different bytes on successive calls); no sleep in the pure function — the caller's fake controls succession.

- [ ] **Step 1: Failing tests** — `packages/capture/test/mumble-reader.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
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
```

- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Implement** — `packages/capture/src/mumble-reader.ts`:

```ts
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

function parseIdentity(buf: Buffer): MumbleIdentity | null {
  try {
    const json = buf.subarray(IDENTITY_OFFSET, IDENTITY_OFFSET + IDENTITY_LEN).toString('utf16le').split('\0')[0]
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
  const tryOrder = chosen !== null ? [chosen] : ranges
  for (const start of tryOrder) {
    const buf = d.readMem(pid, start, IDENTITY_OFFSET + IDENTITY_LEN)
    if (!buf) continue
    const id = parseIdentity(buf)
    if (id) return id
  }
  return null
}
```

- [ ] **Step 4:** Export from `index.ts` (`export * from './mumble-reader.js'`). Run → green.
- [ ] **Step 5: Commit**

```bash
git add packages/capture/src/mumble-reader.ts packages/capture/src/index.ts packages/capture/test/mumble-reader.test.ts
git commit -m "feat(gw2): MumbleLink identity reader (best-effort, injected memory)"
```

---

### Task 3: TitleTemplate variables

**Files:**
- Modify: `packages/app/src/main/TitleTemplate.ts`
- Test: `packages/app/test/title-template.test.ts`

**Interfaces:**
- Consumes: nothing new (context is plain strings).
- Produces: `TemplateContext.gw2?: { character: string; class: string; map: string; race: string }`; vars `character`/`class`/`map`/`race`.

- [ ] **Step 1: Failing tests** — append:

```ts
describe('gw2 variables', () => {
  const ctx = { now: new Date('2026-07-06T12:00:00'), counter: 1, dateFormat: 'YYYY-MM-DD',
    gw2: { character: 'Not Haro', class: 'Mesmer', map: 'Lions Arch', race: 'Sylvari' } }
  it('resolves character/class/map/race', () => {
    expect(renderTitle('{{character}} — {{class}} in {{map}} ({{race}})', ctx)).toBe('Not Haro — Mesmer in Lions Arch (Sylvari)')
  })
  it('missing gw2 context renders them empty (no throw)', () => {
    expect(renderTitle('[{{character}}]', { now: ctx.now, counter: 1, dateFormat: 'YYYY-MM-DD' })).toBe('[]')
  })
  it('existing variables still work alongside', () => {
    expect(renderTitle('{{date}} {{class}}', ctx)).toBe('2026-07-06 Mesmer')
  })
})
```

- [ ] **Step 2:** Run to verify failure — FAIL.
- [ ] **Step 3: Implement** — add `gw2?: { character: string; class: string; map: string; race: string }` to `TemplateContext`; in `renderTitle`'s `vars` map add `character: () => ctx.gw2?.character ?? '', class: () => ctx.gw2?.class ?? '', map: () => ctx.gw2?.map ?? '', race: () => ctx.gw2?.race ?? ''`.
- [ ] **Step 4:** Run → green.
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/TitleTemplate.ts packages/app/test/title-template.test.ts
git commit -m "feat(title): character/class/map/race template variables"
```

---

### Task 4: Go-live resolver + real readMem + UI cheat-sheet

**Files:**
- Modify: `packages/app/src/main/index.ts`, `packages/app/src/renderer/components/YouTubeSettings.tsx`
- Test: `packages/app/test/youtube-settings.test.tsx` if present (cheat-sheet assertion); index wiring is review-verified.

**Interfaces:**
- Consumes: `readIdentity`, `professionName`, `raceName`, `mapName`, `specName` from `@axistream/capture`; the existing `renderTitle` call in the OAuth go-live branch.

- [ ] **Step 1: Wire the resolver.** In `index.ts`:
  - Imports: add `readIdentity, professionName, raceName, mapName, specName, type MumbleDeps` to the `@axistream/capture` import; `import { openSync, readSync, readFileSync, readdirSync } from 'node:fs'` (extend the existing `node:fs` import).
  - A module-level real deps object (near the other consts):

```ts
  // MumbleLink reader deps — /proc/<pid>/mem reads the live address space, so
  // it works for Proton's deleted-tmpfile-backed shared block (no native addon).
  const mumbleDeps: MumbleDeps = {
    readProc: (p) => readFileSync(p, 'utf8'),
    listPids: () => readdirSync('/proc').map(Number).filter((n) => Number.isInteger(n) && n > 0),
    readMem: (pid, addr, len) => {
      try {
        const fd = openSync(`/proc/${pid}/mem`, 'r')
        try { const b = Buffer.alloc(len); readSync(fd, b, 0, len, addr); return b }
        finally { closeSync(fd) }
      } catch { return null }
    },
  }
```

  (add `closeSync` to the fs import.)
  - A resolver helper (before the goLive handler):

```ts
  const fetchJson = async (url: string) => {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`GW2 API ${r.status}`)
    return r.json()
  }
  const resolveGw2 = async (): Promise<{ character: string; class: string; map: string; race: string } | undefined> => {
    const id = readIdentity(mumbleDeps)
    if (!id) return undefined
    const [spec, map] = await Promise.all([specName(id.spec, fetchJson), mapName(id.mapId, fetchJson)])
    return { character: id.character, class: spec || professionName(id.profession), map, race: raceName(id.race) }
  }
```

  - In BOTH title-rendering paths (the OAuth branch computes `title` from `renderTitle(tpl, { now, counter, dateFormat })`; the `previewTitle` handler too), resolve gw2 first under a bounded budget and pass it in. For go-live:

```ts
        const gw2 = await Promise.race([
          resolveGw2().catch(() => undefined),
          new Promise<undefined>((r) => setTimeout(() => r(undefined), 1500)),
        ])
        const title = (titleOverride && titleOverride.trim()) ||
          (tpl && renderTitle(tpl, { now: new Date(), counter: s.counter + 1, dateFormat: s.dateFormat, gw2 }))
```

  For `previewTitle` (so the Settings preview shows real values too): same `Promise.race` wrapper, pass `gw2` into its `renderTitle`. Keep both best-effort — any throw → `gw2` undefined → empty vars.
- [ ] **Step 2: UI cheat-sheet.** In `YouTubeSettings.tsx`, wherever the existing template-variable hint/legend lists `{{date}}` etc., add `{{character}}`, `{{class}}`, `{{map}}`, `{{race}}` with a "(GW2, while in a map)" note. If there's a `youtube-settings.test.tsx`, add an assertion that `{{character}}` appears in the rendered legend; otherwise note it's covered by manual smoke.
- [ ] **Step 3: Verify** — `npm -w @axistream/app run test` green; `cd packages/app && npx tsc --noEmit -p tsconfig.json` zero.
- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main/index.ts packages/app/src/renderer/components/YouTubeSettings.tsx
git commit -m "feat(main): resolve GW2 identity into title vars at go-live; cheat-sheet"
```

(Include `youtube-settings.test.tsx` if touched.)

---

## Final verification (whole branch)

- Capture + app suites green; typecheck zero.
- Manual smoke (human, in a map): template `{{character}} — {{class}} in {{map}}` → go-live/preview title resolves to real values; with GW2 closed the vars render empty and go-live is not delayed.
