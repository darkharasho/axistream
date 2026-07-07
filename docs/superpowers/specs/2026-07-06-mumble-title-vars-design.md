# GW2 MumbleLink Title Variables — Design

**Date:** 2026-07-06
**Status:** Approved (design + live spike); pending implementation plan
**Scope:** Read GW2's MumbleLink shared memory (character, profession/elite,
map, race, commander) and expose new title-template variables
`{{character}}`, `{{class}}`, `{{map}}`, `{{race}}` alongside the existing
date/time/counter ones.

## Ground truth (live spike, 2026-07-06 — recorded in [[mumblelink-spike]])

- **Access:** under Proton the block is a deleted tmpfile (invisible in
  /dev/shm, `map_files` unreadable). Read it with
  **`process_vm_readv(gw2_pid, ...)`** against the `rw-s tmpmap-*` range in
  `/proc/<gw2>/maps` whose u32 tick at offset 4 increments. Same-user, no
  ptrace (yama scope 0). GW2 must be in a map.
- **GW2 pid:** the `/proc` entry whose `comm` is exactly `Gw2-64.exe`.
- **LinkedMem layout (LE):** `uiVersion u32 @0`, `uiTick u32 @4`, name
  `wchar[256] @44`, identity `wchar[256] @592`. Identity is UTF-16LE JSON.
- **Identity JSON:** `{ name, profession (1-9), spec, race (1-5), map_id,
  world_id, commander, ... }`.

## Non-goals

Position/camera/compass data; live overlays; per-second title updates
(title is resolved once at go-live); Windows/macOS MumbleLink (Linux path
only for now — non-Linux `readIdentity` returns null, variables render
empty); GW2 API auth (map/spec names use unauthenticated cached endpoints).

## Architecture

Layered so the risky bits (memory reading, HTTP) are isolated and the
resolver stays pure.

| Unit | Responsibility |
|------|----------------|
| `mumble-reader.ts` (new, capture pkg) | pure-ish: given a `readMem(pid, addr, len)` dep + a `/proc` reader, find the GW2 pid, locate the ticking tmpmap range, `process_vm_readv` it, decode → `MumbleIdentity \| null`. Best-effort, never throws. |
| `gw2-names.ts` (new, capture pkg) | static profession (1-9) + race (1-5) tables (pure, no deps); `mapName(id, fetch)` / `specName(id, fetch)` hitting `/v2/maps/{id}` and `/v2/specializations/{id}`, each memoized in-process. |
| `TitleTemplate.ts` (extend) | `renderTitle` gains optional `gw2` fields on `TemplateContext`; new `{{character}}`/`{{class}}`/`{{map}}`/`{{race}}` variables resolve from them; unknown/missing → empty string (unchanged fallback). |
| `index.ts` go-live | before rendering the title, best-effort `readIdentity()` + name lookups (short timeout); pass resolved strings into the template context. |
| `YouTubeSettings.tsx` | the variable cheat-sheet gains the four new tokens with a "GW2 only" note. |

### mumble-reader.ts

```ts
export interface MumbleIdentity {
  character: string; profession: number; spec: number; race: number; mapId: number; commander: boolean
}
export interface MumbleDeps {
  readProc(path: string): string          // /proc/<pid>/comm, /proc/<pid>/maps
  listPids(): number[]                     // readdirSync('/proc') numeric entries
  readMem(pid: number, addr: number, len: number): Buffer | null  // process_vm_readv wrapper; null on failure
  now?: () => number                       // for the tick re-read (injectable; real uses a tiny sleep)
}
export function findGw2Pid(d: MumbleDeps): number | null
export function readIdentity(d: MumbleDeps): MumbleIdentity | null
```

- `findGw2Pid`: first pid whose `/proc/<pid>/comm` trimmed === `Gw2-64.exe`.
- `readIdentity`: pid → parse `/proc/<pid>/maps` for `rw-s` + `tmpmap-` +
  size ≤ 65536 ranges → for each, `readMem(pid, start+4, 4)` twice (short
  gap) and pick the range whose tick CHANGED (or, if none observed changed
  in one pass, the first range that yields a parseable identity) → read the
  identity window, UTF-16LE decode to the first NUL, `JSON.parse` in a
  try/catch → map to `MumbleIdentity`. Any failure at any step → null.

The `readMem` real implementation lives in a thin `process-vm-readv.ts`
using `process.binding`? No — Node has no `process_vm_readv`. Use a tiny
FFI-free approach: **read `/proc/<pid>/mem`** at the mapped offset
(`fs.readSync` with position) — same-user, works for deleted-file-backed
shared maps because /proc/<pid>/mem reads the live address space, not the
file. This avoids native deps entirely. `readMem` = open `/proc/<pid>/mem`,
`readSync(fd, buf, 0, len, addr)`. (Confirmed viable: the spike's
process_vm_readv worked same-user; /proc/pid/mem has the same permission
model and needs no addon.)

### gw2-names.ts

```ts
export function professionName(id: number): string   // 1..9 table, '' otherwise
export function raceName(id: number): string         // 1..5 table
export async function mapName(id: number, fetchJson: (url: string) => Promise<any>): Promise<string>
export async function specName(id: number, fetchJson: (url: string) => Promise<any>): Promise<string>
```

Profession table: 1 Guardian, 2 Warrior, 3 Engineer, 4 Ranger, 5 Thief,
6 Elementalist, 7 Mesmer, 8 Necromancer, 9 Revenant. Race: 1 Asura,
2 Charr, 3 Human, 4 Norn, 5 Sylvari. `mapName`/`specName` memoize by id in
a module Map; on fetch failure return '' (so the title just omits it).
`{{class}}` uses the elite-spec name when `spec` resolves, else the base
profession — decided in the go-live resolver, not here.

### TitleTemplate context

`TemplateContext` gains `gw2?: { character: string; class: string; map: string; race: string }`
(pre-resolved strings — the template engine stays synchronous and pure).
New vars read from `ctx.gw2?.<field> ?? ''`.

### Go-live resolver (index.ts)

Before `renderTitle`: `const id = readIdentity(mumbleDeps)`; if non-null,
`class = (await specName(id.spec, fetchJson)) || professionName(id.profession)`,
`map = await mapName(id.mapId, fetchJson)`, `race = raceName(id.race)`,
`character = id.character`; wrap the whole block in try/catch with a ~1500 ms
overall budget (Promise.race with a timeout) so a slow/blocked GW2 API can
never delay go-live. Pass `gw2` into the template context; on any failure
`gw2` is undefined and the vars render empty (today's behavior).

## Error handling

Every layer best-effort and null/empty on failure: no GW2 running →
`findGw2Pid` null → empty vars; API down → names empty; non-Linux →
`readIdentity` null. Nothing blocks or delays go-live beyond the bounded
timeout.

## Testing

- **mumble-reader:** injected deps — finds the Gw2-64.exe pid; skips
  wrappers; picks the ticking range; decodes the real captured identity
  JSON (fixture buffer built from the spike's bytes); returns null on
  no-pid / unparseable / readMem-null.
- **gw2-names:** profession/race tables (valid + out-of-range → ''); mapName
  memoizes (second call doesn't re-fetch); fetch-failure → ''.
- **TitleTemplate:** `{{character}}`/`{{class}}`/`{{map}}`/`{{race}}` resolve
  from ctx.gw2; missing gw2 → empty; existing vars unaffected (regression).
- **go-live wiring:** review-verified (timeout budget, null-safe) — no
  harness for index.ts.
- **YouTubeSettings:** cheat-sheet lists the four tokens.
- **Manual smoke:** in a map, set title template
  `{{character}} — {{class}} in {{map}}` → go-live title reads e.g.
  "Not Haro — Mesmer in <mapname>".
