import { describe, it, expect } from 'vitest'
import { renderTitle, formatDate, tidySeparators } from '../src/main/TitleTemplate.js'

const at = (iso: string) => new Date(iso)

describe('formatDate', () => {
  it('formats with M/D/YY and YYYY-MM-DD', () => {
    const d = at('2026-06-24T19:30:00')
    expect(formatDate(d, 'M/D/YY')).toBe('6/24/26')
    expect(formatDate(d, 'YYYY-MM-DD')).toBe('2026-06-24')
  })
})

describe('renderTitle', () => {
  const ctx = { now: at('2026-06-24T19:30:00'), counter: 42, dateFormat: 'YYYY-MM-DD' }

  it('resolves date, day, week, n', () => {
    expect(renderTitle('EWW Raid - {{date}}', ctx)).toBe('EWW Raid - 2026-06-24')
    expect(renderTitle('{{day}}', ctx)).toBe('Wednesday')
    expect(renderTitle('Week {{week}}', ctx)).toBe('Week 26')
    expect(renderTitle('Stream #{{n}}', ctx)).toBe('Stream #42')
  })

  it('resolves time', () => {
    expect(renderTitle('{{time}}', ctx)).toMatch(/^\d{1,2}:\d{2}/)
  })

  it('renders unknown variables as empty string', () => {
    // The hole closes up rather than leaving a double space — see tidySeparators.
    expect(renderTitle('a {{bogus}} b', ctx)).toBe('a b')
  })

  it('respects configured date format', () => {
    expect(renderTitle('{{date}}', { ...ctx, dateFormat: 'M/D/YY' })).toBe('6/24/26')
  })
})

describe('gw2 variables', () => {
  const ctx = { now: new Date('2026-07-06T12:00:00'), counter: 1, dateFormat: 'YYYY-MM-DD',
    gw2: { character: 'Not Haro', class: 'Mesmer', map: 'Lions Arch', race: 'Sylvari', team: 'Red' } }
  it('resolves character/class/map/race', () => {
    expect(renderTitle('{{character}} — {{class}} in {{map}} ({{race}})', ctx)).toBe('Not Haro — Mesmer in Lions Arch (Sylvari)')
    expect(renderTitle('{{team}} team', ctx)).toBe('Red team')
  })
  it('missing gw2 context renders them empty (no throw)', () => {
    expect(renderTitle('[{{character}}]', { now: ctx.now, counter: 1, dateFormat: 'YYYY-MM-DD' })).toBe('[]')
  })
  it('existing variables still work alongside', () => {
    expect(renderTitle('{{date}} {{class}}', ctx)).toBe('2026-07-06 Mesmer')
  })
})

// GW2 closed at go-live used to publish "2026-08-31 WvW Raid -  -  -".
describe('tidySeparators', () => {
  it('drops trailing and doubled separators', () => {
    expect(tidySeparators('2026-08-31 WvW Raid -  -  -')).toBe('2026-08-31 WvW Raid')
    expect(tidySeparators('A - - B')).toBe('A - B')
    expect(tidySeparators('| A')).toBe('A')
  })

  it('leaves separators that have content on both sides', () => {
    expect(tidySeparators('Willbender - WvW')).toBe('Willbender - WvW')
    expect(tidySeparators('2026-08-31 · Raid / Night')).toBe('2026-08-31 · Raid / Night')
  })
})

describe('renderTitle with unresolved gw2 variables', () => {
  const ctx = { now: new Date('2026-08-31T20:00:00'), counter: 1, dateFormat: 'YYYY-MM-DD' }

  it('closes the gaps a closed GW2 leaves', () => {
    expect(renderTitle('{{date}} WvW Raid - {{character}} - {{class}} - {{map}}', ctx))
      .toBe('2026-08-31 WvW Raid')
    expect(renderTitle('{{character}} - WvW - {{map}}', ctx)).toBe('WvW')
  })

  it('leaves a fully resolved title exactly as written', () => {
    const gw2 = { character: 'Not Haro', class: 'Mesmer', map: 'Lions Arch', race: 'Sylvari', team: 'Red' }
    expect(renderTitle('{{date}} WvW Raid -  {{character}}', { ...ctx, gw2 }))
      .toBe('2026-08-31 WvW Raid -  Not Haro')
  })
})
