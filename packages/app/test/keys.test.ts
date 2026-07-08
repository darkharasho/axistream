import { describe, it, expect } from 'vitest'
import { PTT_KEY_CHOICES, keyName, PTT_KEY_GROUPS, MODIFIER_CODES, bindingLabel, evdevToVk, MODIFIER_VKS } from '../src/shared/keys.js'

describe('PTT key table', () => {
  it('pins the codes that matter', () => {
    const byName = Object.fromEntries(PTT_KEY_CHOICES.map((k) => [k.name, k.code]))
    expect(byName['F13']).toBe(183)
    expect(byName['F18']).toBe(188)
    expect(byName['F24']).toBe(194)
    expect(byName['F1']).toBe(59)
    expect(byName['F11']).toBe(87)
    expect(byName['F12']).toBe(88)
    expect(byName['Pause']).toBe(119)
  })
  it('has no duplicate codes or names', () => {
    expect(new Set(PTT_KEY_CHOICES.map((k) => k.code)).size).toBe(PTT_KEY_CHOICES.length)
    expect(new Set(PTT_KEY_CHOICES.map((k) => k.name)).size).toBe(PTT_KEY_CHOICES.length)
  })
  it('keyName falls back to KEY_<code> off the table', () => {
    expect(keyName(188)).toBe('F18')
    expect(keyName(275)).toBe('KEY_275')
  })
})

describe('key groups and bindings', () => {
  it('groups carry the exact evdev codes (spot checks)', () => {
    const flat = new Map(PTT_KEY_GROUPS.flatMap((g) => g.keys).map((k) => [k.name, k.code]))
    expect(flat.get('Q')).toBe(16)
    expect(flat.get('A')).toBe(30)
    expect(flat.get('M')).toBe(50)
    expect(flat.get('1')).toBe(2)
    expect(flat.get('0')).toBe(11)
    expect(flat.get('Grave')).toBe(41)
    expect(flat.get('Backslash')).toBe(43)
    expect(flat.get('F18')).toBe(188)
    expect(flat.get('PageDown')).toBe(109)
  })
  it('letters are alphabetical for display', () => {
    const letters = PTT_KEY_GROUPS.find((g) => g.label === 'Letters')!.keys.map((k) => k.name)
    expect(letters).toEqual([...letters].sort())
    expect(letters).toHaveLength(26)
  })
  it('keyName resolves group members and falls back to KEY_<n>', () => {
    expect(keyName(47)).toBe('V')
    expect(keyName(188)).toBe('F18')
    expect(keyName(275)).toBe('KEY_275')
  })
  it('MODIFIER_CODES carries left/right evdev pairs', () => {
    expect(MODIFIER_CODES.ctrl).toEqual([29, 97])
    expect(MODIFIER_CODES.shift).toEqual([42, 54])
    expect(MODIFIER_CODES.alt).toEqual([56, 100])
    expect(MODIFIER_CODES.super).toEqual([125, 126])
  })
  it('bindingLabel renders with and without modifier', () => {
    expect(bindingLabel({ key: { code: 188, name: 'F18' }, modifier: null })).toBe('F18')
    expect(bindingLabel({ key: { code: 188, name: 'F18' }, modifier: 'ctrl' })).toBe('Ctrl + F18')
  })
})

describe('evdevToVk', () => {
  it('maps F18 (evdev 188) to VK 0x81', () => {
    expect(evdevToVk(188)).toBe(0x81)
  })
  it('maps V (evdev 47) to VK 0x56', () => {
    expect(evdevToVk(47)).toBe(0x56)
  })
  it("maps digit '1' (evdev 2) to VK 0x31", () => {
    expect(evdevToVk(2)).toBe(0x31)
  })
  it('maps PageUp (evdev 104) to VK 0x21', () => {
    expect(evdevToVk(104)).toBe(0x21)
  })
  it('maps BTN_SIDE (evdev 275) to VK 0x05', () => {
    expect(evdevToVk(275)).toBe(0x05)
  })
  it('returns null for an unknown evdev code (999)', () => {
    expect(evdevToVk(999)).toBeNull()
  })
  it('maps all F-keys in range F1–F24', () => {
    // F1–F10: evdev 59–68 → VK 0x70–0x79
    expect(evdevToVk(59)).toBe(0x70)  // F1
    expect(evdevToVk(68)).toBe(0x79)  // F10
    expect(evdevToVk(87)).toBe(0x7A)  // F11
    expect(evdevToVk(88)).toBe(0x7B)  // F12
    expect(evdevToVk(183)).toBe(0x7C) // F13
    expect(evdevToVk(194)).toBe(0x87) // F24
  })
  it('maps all digit keys', () => {
    expect(evdevToVk(2)).toBe(0x31)   // '1'
    expect(evdevToVk(10)).toBe(0x39)  // '9'
    expect(evdevToVk(11)).toBe(0x30)  // '0'
  })
  it('maps navigation keys', () => {
    expect(evdevToVk(110)).toBe(0x2D) // Insert
    expect(evdevToVk(102)).toBe(0x24) // Home
    expect(evdevToVk(107)).toBe(0x23) // End
    expect(evdevToVk(109)).toBe(0x22) // PageDown
    expect(evdevToVk(119)).toBe(0x13) // Pause
    expect(evdevToVk(70)).toBe(0x91)  // ScrollLock
    expect(evdevToVk(41)).toBe(0xC0)  // Grave
    expect(evdevToVk(43)).toBe(0xDC)  // Backslash
  })
  it('maps mouse buttons', () => {
    expect(evdevToVk(272)).toBe(0x01) // BTN_LEFT
    expect(evdevToVk(273)).toBe(0x02) // BTN_RIGHT
    expect(evdevToVk(274)).toBe(0x04) // BTN_MIDDLE
    expect(evdevToVk(276)).toBe(0x06) // BTN_EXTRA
  })
})

describe('MODIFIER_VKS', () => {
  it('ctrl maps to [0x11]', () => {
    expect(MODIFIER_VKS.ctrl).toEqual([0x11])
  })
  it('shift maps to [0x10]', () => {
    expect(MODIFIER_VKS.shift).toEqual([0x10])
  })
  it('alt maps to [0x12]', () => {
    expect(MODIFIER_VKS.alt).toEqual([0x12])
  })
  it('super maps to [0x5B, 0x5C]', () => {
    expect(MODIFIER_VKS.super).toEqual([0x5B, 0x5C])
  })
})
