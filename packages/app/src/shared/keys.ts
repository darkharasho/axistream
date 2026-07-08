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
