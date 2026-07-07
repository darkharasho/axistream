export interface PttKey { code: number; name: string }

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

const NAMES = new Map(PTT_KEY_CHOICES.map((k) => [k.code, k.name]))

export function keyName(code: number): string {
  return NAMES.get(code) ?? `KEY_${code}`
}
