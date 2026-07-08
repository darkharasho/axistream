export interface PttKey { code: number; name: string }

export type PttCaptureResult =
  | { key: PttKey }
  | { reason: 'timeout' | 'cancelled' | 'unavailable' }

// evdev keycodes from linux input-event-codes.h — the curated picker set.
export const PTT_KEY_CHOICES: PttKey[] = [
  ...Array.from({ length: 10 }, (_, i) => ({ code: 59 + i, name: `F${i + 1}` })),
  { code: 87, name: 'F11' },
  { code: 88, name: 'F12' },
  ...Array.from({ length: 12 }, (_, i) => ({ code: 183 + i, name: `F${i + 13}` })),
  { code: 119, name: 'Pause' },
  { code: 70, name: 'ScrollLock' },
  { code: 110, name: 'Insert' },
  { code: 102, name: 'Home' },
  { code: 107, name: 'End' },
  { code: 104, name: 'PageUp' },
  { code: 109, name: 'PageDown' },
]

export type PttModifier = 'ctrl' | 'alt' | 'shift' | 'super'
export interface PttBinding { key: PttKey; modifier: PttModifier | null }

/** [left, right] evdev codes — either side satisfies the modifier. */
export const MODIFIER_CODES: Record<PttModifier, [number, number]> = {
  ctrl: [29, 97], shift: [42, 54], alt: [56, 100], super: [125, 126],
}
export const MODIFIER_LABELS: Record<PttModifier, string> = {
  ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', super: 'Super',
}

export interface PttKeyGroup { label: string; keys: PttKey[] }

const LETTER_CODES: Record<string, number> = {
  A: 30, B: 48, C: 46, D: 32, E: 18, F: 33, G: 34, H: 35, I: 23, J: 36,
  K: 37, L: 38, M: 50, N: 49, O: 24, P: 25, Q: 16, R: 19, S: 31, T: 20,
  U: 22, V: 47, W: 17, X: 45, Y: 21, Z: 44,
}

export const PTT_KEY_GROUPS: PttKeyGroup[] = [
  { label: 'Function', keys: [
    ...Array.from({ length: 10 }, (_, i) => ({ code: 59 + i, name: `F${i + 1}` })),
    { code: 87, name: 'F11' },
    { code: 88, name: 'F12' },
    ...Array.from({ length: 12 }, (_, i) => ({ code: 183 + i, name: `F${i + 13}` })),
  ] },
  { label: 'Letters', keys: Object.keys(LETTER_CODES).sort().map((n) => ({ code: LETTER_CODES[n], name: n })) },
  { label: 'Numbers', keys: [
    ...Array.from({ length: 9 }, (_, i) => ({ code: 2 + i, name: `${i + 1}` })),
    { code: 11, name: '0' },
  ] },
  { label: 'Navigation & misc', keys: [
    { code: 110, name: 'Insert' },
    { code: 102, name: 'Home' },
    { code: 107, name: 'End' },
    { code: 104, name: 'PageUp' },
    { code: 109, name: 'PageDown' },
    { code: 119, name: 'Pause' },
    { code: 70, name: 'ScrollLock' },
    { code: 41, name: 'Grave' },
    { code: 43, name: 'Backslash' },
  ] },
]

export function bindingLabel(b: PttBinding): string {
  return b.modifier ? `${MODIFIER_LABELS[b.modifier]} + ${b.key.name}` : b.key.name
}

const NAMES = new Map([...PTT_KEY_CHOICES, ...PTT_KEY_GROUPS.flatMap((g) => g.keys)].map((k) => [k.code, k.name]))

export function keyName(code: number): string {
  return NAMES.get(code) ?? `KEY_${code}`
}

/** Whether a code is in the curated picker set — press-to-bind clamps to
 *  this so the exclusive dropdown and portal hints stay coherent. */
export function isKnownKey(code: number): boolean {
  return NAMES.has(code)
}

// ---------------------------------------------------------------------------
// Windows virtual-key mapping
// ---------------------------------------------------------------------------

// Build evdev→VK map from the group tables where the mapping is systematic.
// Letters: VK = 0x41 + (letter index A-Z). Digits: VK = 0x30-0x39.
// F-keys, navigation, misc and mouse buttons handled explicitly below.

const _evdevToVk = new Map<number, number>()

// Letters — built from LETTER_CODES (evdev) and the A-Z VK range (A=0x41…Z=0x5A).
for (const letter of Object.keys(LETTER_CODES)) {
  _evdevToVk.set(LETTER_CODES[letter], 0x41 + letter.charCodeAt(0) - 'A'.charCodeAt(0))
}

// Digits 1–9 (evdev 2–10 → VK 0x31–0x39) and 0 (evdev 11 → VK 0x30)
for (let i = 0; i < 9; i++) { _evdevToVk.set(2 + i, 0x31 + i) }
_evdevToVk.set(11, 0x30)

// F1–F10: evdev 59–68 → VK 0x70–0x79
for (let i = 0; i < 10; i++) { _evdevToVk.set(59 + i, 0x70 + i) }
// F11, F12: evdev 87, 88 → VK 0x7A, 0x7B
_evdevToVk.set(87, 0x7A)
_evdevToVk.set(88, 0x7B)
// F13–F24: evdev 183–194 → VK 0x7C–0x87
for (let i = 0; i < 12; i++) { _evdevToVk.set(183 + i, 0x7C + i) }

// Navigation & misc
_evdevToVk.set(110, 0x2D)  // Insert
_evdevToVk.set(102, 0x24)  // Home
_evdevToVk.set(107, 0x23)  // End
_evdevToVk.set(104, 0x21)  // PageUp
_evdevToVk.set(109, 0x22)  // PageDown
_evdevToVk.set(119, 0x13)  // Pause
_evdevToVk.set(70,  0x91)  // ScrollLock
_evdevToVk.set(41,  0xC0)  // Grave
_evdevToVk.set(43,  0xDC)  // Backslash

// Mouse buttons
_evdevToVk.set(272, 0x01)  // BTN_LEFT
_evdevToVk.set(273, 0x02)  // BTN_RIGHT
_evdevToVk.set(274, 0x04)  // BTN_MIDDLE
_evdevToVk.set(275, 0x05)  // BTN_SIDE
_evdevToVk.set(276, 0x06)  // BTN_EXTRA

/** Map an evdev input code to a Windows virtual-key code.
 *  Returns null for codes with no Windows equivalent. */
export function evdevToVk(code: number): number | null {
  return _evdevToVk.get(code) ?? null
}

/** Windows VK codes for each PTT modifier (either VK satisfies the modifier). */
export const MODIFIER_VKS: Record<PttModifier, number[]> = {
  ctrl:  [0x11],        // VK_CONTROL (GetAsyncKeyState tracks left/right via this)
  shift: [0x10],        // VK_SHIFT
  alt:   [0x12],        // VK_MENU
  super: [0x5B, 0x5C], // VK_LWIN, VK_RWIN
}
