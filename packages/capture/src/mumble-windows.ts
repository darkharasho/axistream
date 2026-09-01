// packages/capture/src/mumble-windows.ts
// Windows MumbleLink backend. GW2 publishes its LinkedMem block as a named
// file mapping ("MumbleLink") in the session namespace, so there is no pid to
// find and no address space to walk — none of the Linux reader's /proc
// vocabulary applies. The two platforms share exactly one thing, the identity
// decode, and that lives in mumble-reader.ts as identityFromBlock.
import { createRequire } from 'node:module'
import { identityFromBlock, LINKED_MEM_SIZE, type MumbleIdentity } from './mumble-reader.js'

/** The name Mumble standardised and GW2 uses. Session-local, not Global\. */
export const MUMBLE_MAP_NAME = 'MumbleLink'

export interface WindowsMumbleDeps {
  /** Maps the named shared block read-only and copies it out. null if absent. */
  mapBlock(name: string, size: number): Buffer | null
}

/** Read GW2's MumbleLink identity on Windows. Best-effort — null when GW2
 *  isn't running, is sitting on character select, or anything at all fails.
 *
 *  Deliberately no liveness gate, unlike the Linux reader: that one polls
 *  uiTick because Proton exposes several candidate tmpmap- regions and only
 *  one is the real block. Here there is exactly one name and nothing to
 *  disambiguate, so a tick check would only buy a sleep inside the 1500 ms
 *  budget go-live races this call against. A stale block left by another
 *  Mumble-aware app is zeroed and fails the identity parse anyway. */
export function readIdentityWindows(d: WindowsMumbleDeps): MumbleIdentity | null {
  let block: Buffer | null
  try { block = d.mapBlock(MUMBLE_MAP_NAME, LINKED_MEM_SIZE) } catch { return null }
  if (!block) return null
  return identityFromBlock(block)
}

const FILE_MAP_READ = 0x0004

interface Kernel32Mapping {
  open(access: number, inherit: boolean, name: string): unknown
  map(handle: unknown, access: number, offHigh: number, offLow: number, bytes: number): unknown
  copy(dst: Buffer, src: unknown, len: number): void
  unmap(view: unknown): void
  close(handle: unknown): void
}

// Loaded once on first use; if koffi or kernel32 is unavailable it stays null
// and mapBlock reports "no mapping", which is the same answer the caller
// already handles for "GW2 isn't running". Unlike the PTT backend this must
// never throw: a missing identity costs a title variable, not a hot mic.
let _api: Kernel32Mapping | null = null
let _loaded = false

function loadKernel32(): Kernel32Mapping | null {
  if (_loaded) return _api
  _loaded = true
  try {
    const require = createRequire(import.meta.url)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const koffi = require('koffi') as any
    const kernel32 = koffi.load('kernel32.dll')
    const OpenFileMappingW = kernel32.func('void *OpenFileMappingW(uint32 access, bool inherit, const char16_t *name)')
    const MapViewOfFile = kernel32.func('void *MapViewOfFile(void *object, uint32 access, uint32 offsetHigh, uint32 offsetLow, size_t bytes)')
    // RtlMoveMemory is kernel32's memmove; it is how the mapped view becomes a
    // Node Buffer without koffi having to understand LinkedMem's layout.
    const RtlMoveMemory = kernel32.func('void RtlMoveMemory(_Out_ uint8 *dst, const void *src, size_t len)')
    const UnmapViewOfFile = kernel32.func('bool UnmapViewOfFile(const void *base)')
    const CloseHandle = kernel32.func('bool CloseHandle(void *handle)')
    _api = {
      open: (access, inherit, name) => OpenFileMappingW(access, inherit, name),
      map: (handle, access, offHigh, offLow, bytes) => MapViewOfFile(handle, access, offHigh, offLow, bytes),
      copy: (dst, src, len) => { RtlMoveMemory(dst, src, len) },
      unmap: (view) => { UnmapViewOfFile(view) },
      close: (handle) => { CloseHandle(handle) },
    }
  } catch { _api = null }
  return _api
}

export const windowsMumbleDeps: WindowsMumbleDeps = {
  mapBlock(name, size) {
    const api = loadKernel32()
    if (!api) return null
    let handle: unknown = null
    let view: unknown = null
    try {
      handle = api.open(FILE_MAP_READ, false, name)
      if (!handle) return null
      view = api.map(handle, FILE_MAP_READ, 0, 0, size)
      if (!view) return null
      const out = Buffer.alloc(size)
      api.copy(out, view, size)
      return out
    } catch { return null } finally {
      // Unconditional: a leaked view or handle here leaks on every go-live.
      try { if (view) api.unmap(view) } catch { /* best-effort */ }
      try { if (handle) api.close(handle) } catch { /* best-effort */ }
    }
  },
}
