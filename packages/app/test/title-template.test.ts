import { describe, it, expect } from 'vitest'
import { renderTitle, formatDate } from '../src/main/TitleTemplate.js'

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
    expect(renderTitle('a {{bogus}} b', ctx)).toBe('a  b')
  })

  it('respects configured date format', () => {
    expect(renderTitle('{{date}}', { ...ctx, dateFormat: 'M/D/YY' })).toBe('6/24/26')
  })
})
