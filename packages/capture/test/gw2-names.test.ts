import { describe, it, expect, vi } from 'vitest'
import { professionName, raceName, mapName, specName, teamColorName } from '../src/gw2-names.js'

describe('static tables', () => {
  it('profession ids map to names; out-of-range is empty', () => {
    expect(professionName(1)).toBe('Guardian')
    expect(professionName(7)).toBe('Mesmer')
    expect(professionName(9)).toBe('Revenant')
    expect(professionName(0)).toBe('')
    expect(professionName(10)).toBe('')
  })
  it('race ids map to names', () => {
    expect(raceName(1)).toBe('Asura')
    expect(raceName(4)).toBe('Norn')
    expect(raceName(6)).toBe('')
  })
})

describe('mapName / specName memoized lookups', () => {
  it('mapName fetches once and memoizes', async () => {
    const fetchJson = vi.fn(async () => ({ name: 'Fractals of the Mists' }))
    expect(await mapName(950001, fetchJson)).toBe('Fractals of the Mists')
    expect(await mapName(950001, fetchJson)).toBe('Fractals of the Mists')
    expect(fetchJson).toHaveBeenCalledTimes(1)
    expect(fetchJson).toHaveBeenCalledWith('https://api.guildwars2.com/v2/maps/950001')
  })
  it('specName fetches the specialization name', async () => {
    const fetchJson = vi.fn(async () => ({ name: 'Chronomancer' }))
    expect(await specName(950002, fetchJson)).toBe('Chronomancer')
    expect(fetchJson).toHaveBeenCalledWith('https://api.guildwars2.com/v2/specializations/950002')
  })
  it('fetch failure yields empty string', async () => {
    const fetchJson = vi.fn(async () => { throw new Error('offline') })
    expect(await mapName(950003, fetchJson)).toBe('')
    expect(await specName(950004, fetchJson)).toBe('')
  })
  it('missing name field yields empty string', async () => {
    const fetchJson = vi.fn(async () => ({}))
    expect(await mapName(950005, fetchJson)).toBe('')
  })
})

describe('teamColorName', () => {
  it('classifies the team-color dye by dominant channel', async () => {
    const red = vi.fn(async () => ({ cloth: { rgb: [133, 36, 26] } }))
    expect(await teamColorName(376, red)).toBe('Red')
    const green = vi.fn(async () => ({ cloth: { rgb: [40, 120, 45] } }))
    expect(await teamColorName(377, green)).toBe('Green')
    const blue = vi.fn(async () => ({ cloth: { rgb: [30, 50, 140] } }))
    expect(await teamColorName(378, blue)).toBe('Blue')
  })
  it('memoizes and returns empty on id 0 / failure / missing rgb', async () => {
    const f = vi.fn(async () => ({ cloth: { rgb: [133, 36, 26] } }))
    expect(await teamColorName(9376, f)).toBe('Red')
    expect(await teamColorName(9376, f)).toBe('Red')
    expect(f).toHaveBeenCalledTimes(1)
    expect(await teamColorName(0, f)).toBe('')
    expect(await teamColorName(9377, vi.fn(async () => { throw new Error('offline') }))).toBe('')
    expect(await teamColorName(9378, vi.fn(async () => ({})))).toBe('')
  })
})
