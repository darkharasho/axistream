import { describe, it, expect } from 'vitest'
import { staleOption } from '../src/renderer/device-options.js'

const devs = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]

describe('staleOption', () => {
  it('null saved → null', () => { expect(staleOption(null, devs)).toBeNull() })
  it('empty-string saved → null', () => { expect(staleOption('', devs)).toBeNull() })
  it('saved present in list → null', () => { expect(staleOption('a', devs)).toBeNull() })
  it('saved missing → labeled placeholder with the saved id', () => {
    expect(staleOption('gone', devs)).toEqual({ id: 'gone', name: 'Saved device (unavailable)' })
  })
  it('empty device list + saved → placeholder', () => {
    expect(staleOption('gone', [])).toEqual({ id: 'gone', name: 'Saved device (unavailable)' })
  })
  it('custom label is used when provided; default unchanged', () => {
    expect(staleOption('gone', devs, 'Saved app (not running)')).toEqual({ id: 'gone', name: 'Saved app (not running)' })
    expect(staleOption('gone', devs)).toEqual({ id: 'gone', name: 'Saved device (unavailable)' })
  })
})
