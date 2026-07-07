import { describe, it, expect } from 'vitest'
import { PTT_KEY_CHOICES, keyName } from '../src/shared/keys.js'

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
    expect(keyName(30)).toBe('KEY_30')
  })
})
