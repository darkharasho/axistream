import { describe, it, expect, vi } from 'vitest'
import { professionName, raceName, mapName, specName } from '../src/gw2-names.js'

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
