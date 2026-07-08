import { describe, it, expect } from 'vitest'
import { PTT_KEY_CHOICES, keyName, PTT_KEY_GROUPS, MODIFIER_CODES, bindingLabel } from '../src/shared/keys.js'

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
