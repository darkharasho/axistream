// packages/app/src/main/windows-keys.ts
// Windows PTT backend: observational polling via GetAsyncKeyState (user32.dll,
// loaded once via koffi FFI — no compile step). Mirrors evdev-keys semantics:
// 25 ms interval, edge detection, modifier gating. Nothing is consumed —
// Discord's own PTT coexists identically to Linux passthrough.
//
// koffi is NOT yet in package.json (Task 2 adds it). The require is dynamic
// and wrapped in try/catch so tsc compiles clean and non-win32 hosts never
// attempt to load it.
import { createRequire } from 'node:module'
import { keyName, evdevToVk, MODIFIER_VKS, type PttBinding, type PttModifier } from '../shared/keys.js'
import type { BindSpec, BoundSet } from '../shared/hotkeys.js'

const _require = createRequire(import.meta.url)

// Same structural shape as evdev-keys' BoundShortcut — PttController accepts
// either backend unchanged.
export interface BoundShortcut {
  onActivated(cb: () => void): void
  onDeactivated(cb: () => void): void
  close(): Promise<void>
}

export interface WindowsKeysDeps {
  /** Returns true when the given VK is currently held (high-bit set). */
  keyDown(vk: number): boolean
  /** process.platform equivalent — real deps pass process.platform. */
  platform: string
}

// Lazily loaded real keyDown using koffi + user32.dll.
// Loaded once on first call; if koffi is absent or fails, stays null.
let _realKeyDown: ((vk: number) => boolean) | null = null
let _koffiLoaded = false
let _koffiAvailable = false

function loadKoffi(): boolean {
  if (_koffiLoaded) return _koffiAvailable
  _koffiLoaded = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const koffi = _require('koffi') as any
    const lib = koffi.load('user32.dll')
    const GetAsyncKeyState = lib.func('short __stdcall GetAsyncKeyState(int)')
    _realKeyDown = (vk: number) => (GetAsyncKeyState(vk) & 0x8000) !== 0
    _koffiAvailable = true
  } catch {
    _koffiAvailable = false
  }
  return _koffiAvailable
}

const realDeps: WindowsKeysDeps = {
  get keyDown() {
    loadKoffi()
    // If koffi didn't load, return a no-op that always returns false.
    return _realKeyDown ?? (() => false)
  },
  platform: process.platform,
}

const POLL_MS = 25

export function createWindowsKeys(deps: WindowsKeysDeps = realDeps) {
  const self = {
    async available(): Promise<boolean> {
      if (deps.platform !== 'win32') return false
      // For injected (test) deps, availability is simply platform===win32.
      // For real deps, we also require koffi to have loaded successfully.
      if (deps === realDeps) return loadKoffi()
      return true
    },

    async bindAll(specs: BindSpec[]): Promise<BoundSet> {
      let onAct: ((id: string) => void) | null = null
      let onDeact: ((id: string) => void) | null = null

      // Edge-detection state per spec. We seed keyWasDown from the actual
      // current key state so a key already held at arm time is seen as "was
      // already down" and produces no down-edge until it cycles (release →
      // press again). Consequence: worst case is one missed activation on the
      // very first use, matching the evdev modifier-held-before-arm note.
      // A spec whose key has no Windows VK equivalent is dropped — one
      // unsupported key must not disarm every other action.
      const watches = specs.flatMap((s) => {
        const keyVk = evdevToVk(s.binding.key.code)
        if (keyVk === null) {
          console.warn(`[hotkeys] key not supported on Windows, skipping "${s.id}": ${keyName(s.binding.key.code)}`)
          return []
        }
        const modVks: number[] | null = s.binding.modifier ? MODIFIER_VKS[s.binding.modifier as PttModifier] : null
        return [{
          id: s.id,
          keyVk,
          modVks,
          keyWasDown: deps.keyDown(keyVk),
          active: false,
        }]
      })

      const timer = setInterval(() => {
        for (const w of watches) {
          const keyIsDown = deps.keyDown(w.keyVk)
          // Modifier: true when no modifier configured, or when ANY of its
          // VKs are held. GetAsyncKeyState(VK_CONTROL/SHIFT/MENU) tracks both
          // sides.
          const modHeld = w.modVks === null || w.modVks.some((vk) => deps.keyDown(vk))

          if (!w.keyWasDown && keyIsDown) {
            // Down edge
            if (modHeld && !w.active) {
              w.active = true
              onAct?.(w.id)
            }
          } else if (w.keyWasDown && !keyIsDown) {
            // Up edge
            if (w.active) {
              w.active = false
              onDeact?.(w.id)
            }
          } else if (keyIsDown && w.active && !modHeld) {
            // Key still held but modifier was released
            w.active = false
            onDeact?.(w.id)
          }

          w.keyWasDown = keyIsDown
        }
      }, POLL_MS)

      return {
        onActivated: (cb) => { onAct = cb },
        onDeactivated: (cb) => { onDeact = cb },
        close: async () => { clearInterval(timer) },
      }
    },

    async bind(id: string, description: string, binding: PttBinding): Promise<BoundShortcut> {
      if (evdevToVk(binding.key.code) === null) {
        throw new Error(`key not supported on Windows: ${keyName(binding.key.code)}`)
      }
      const set = await self.bindAll([{ id, description, binding }])
      return {
        onActivated: (cb) => set.onActivated(() => cb()),
        onDeactivated: (cb) => set.onDeactivated(() => cb()),
        close: () => set.close(),
      }
    },
  }
  return self
}
