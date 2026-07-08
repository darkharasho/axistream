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
  return {
    async available(): Promise<boolean> {
      if (deps.platform !== 'win32') return false
      // For injected (test) deps, availability is simply platform===win32.
      // For real deps, we also require koffi to have loaded successfully.
      if (deps === realDeps) return loadKoffi()
      return true
    },

    async bind(_id: string, _description: string, binding: PttBinding): Promise<BoundShortcut> {
      const { key, modifier } = binding
      const keyVk = evdevToVk(key.code)
      if (keyVk === null) {
        throw new Error(`key not supported on Windows: ${keyName(key.code)}`)
      }
      const modVks: number[] | null = modifier ? MODIFIER_VKS[modifier as PttModifier] : null

      let onAct: (() => void) | null = null
      let onDeact: (() => void) | null = null

      // Edge-detection state. We seed keyWasDown from the actual current key
      // state so a key already held at arm time is seen as "was already down"
      // and produces no down-edge until it cycles (release → press again).
      // Consequence: worst case is one missed activation on the very first use,
      // matching the evdev modifier-held-before-arm note.
      let keyWasDown = deps.keyDown(keyVk)
      let active = false

      const timer = setInterval(() => {
        const keyIsDown = deps.keyDown(keyVk)
        // Modifier: true when no modifier configured, or when ANY of its VKs
        // are held. GetAsyncKeyState(VK_CONTROL/SHIFT/MENU) tracks both sides.
        const modHeld = modVks === null || modVks.some((vk) => deps.keyDown(vk))

        if (!keyWasDown && keyIsDown) {
          // Down edge
          if (modHeld && !active) {
            active = true
            onAct?.()
          }
        } else if (keyWasDown && !keyIsDown) {
          // Up edge
          if (active) {
            active = false
            onDeact?.()
          }
        } else if (keyIsDown && active && !modHeld) {
          // Key still held but modifier was released
          active = false
          onDeact?.()
        }

        keyWasDown = keyIsDown
      }, POLL_MS)

      return {
        onActivated: (cb) => { onAct = cb },
        onDeactivated: (cb) => { onDeact = cb },
        close: async () => { clearInterval(timer) },
      }
    },
  }
}
