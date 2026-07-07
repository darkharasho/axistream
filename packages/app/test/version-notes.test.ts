import { describe, it, expect } from 'vitest'
import { parseVersion, compareVersion, selectReleaseNotes } from '../src/main/version-notes.js'

describe('parseVersion', () => {
  it('parses with/without v and rejects garbage', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('0.1.4')).toEqual([0, 1, 4])
    expect(parseVersion('nope')).toBeNull()
    expect(parseVersion(null)).toBeNull()
  })
})

describe('compareVersion', () => {
  it('orders correctly', () => {
    expect(compareVersion([0, 1, 4], [0, 1, 3])).toBeGreaterThan(0)
    expect(compareVersion([0, 1, 3], [0, 2, 0])).toBeLessThan(0)
    expect(compareVersion([1, 0, 0], [1, 0, 0])).toBe(0)
  })
})

describe('selectReleaseNotes', () => {
  const rels = [
    { tag: 'v0.1.4', body: 'four' },
    { tag: 'v0.1.3', body: 'three' },
    { tag: 'v0.1.2', body: 'two' },
  ]
  it('returns notes newer than lastSeen up to current, newest first', () => {
    const out = selectReleaseNotes(rels, '0.1.4', '0.1.2')
    expect(out).toContain('four')
    expect(out).toContain('three')
    expect(out).not.toContain('two')
    expect(out!.indexOf('four')).toBeLessThan(out!.indexOf('three'))
  })
  it('excludes releases newer than current', () => {
    const out = selectReleaseNotes([{ tag: 'v0.2.0', body: 'future' }, ...rels], '0.1.4', '0.1.3')
    expect(out).not.toContain('future')
    expect(out).toContain('four')
  })
  it('null when nothing in range', () => {
    expect(selectReleaseNotes(rels, '0.1.2', '0.1.2')).toBeNull()
  })
  it('no lastSeen → everything up to current', () => {
    expect(selectReleaseNotes(rels, '0.1.4', null)).toContain('two')
  })
})
