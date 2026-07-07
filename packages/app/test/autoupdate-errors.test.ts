import { describe, it, expect } from 'vitest'
import { extractAutoUpdateErrorMessage, isRetryableAutoUpdateError, formatAutoUpdateErrorMessage } from '../src/shared/autoupdate-errors.js'

describe('extractAutoUpdateErrorMessage', () => {
  it('reads string, Error, and object-with-message', () => {
    expect(extractAutoUpdateErrorMessage('boom')).toBe('boom')
    expect(extractAutoUpdateErrorMessage(new Error('nope'))).toBe('nope')
    expect(extractAutoUpdateErrorMessage({ message: 'x' })).toBe('x')
    expect(extractAutoUpdateErrorMessage(null)).toBe('')
  })
})

describe('isRetryableAutoUpdateError', () => {
  it('true for transient network classes', () => {
    for (const m of ['ERR_HTTP2_SERVER_REFUSED_STREAM', 'ECONNRESET', 'ETIMEDOUT', 'socket hang up', 'Request timed out', 'Error: 503']) {
      expect(isRetryableAutoUpdateError(new Error(m))).toBe(true)
    }
  })
  it('false for a real failure', () => {
    expect(isRetryableAutoUpdateError(new Error('ENOENT unlink /x.AppImage'))).toBe(false)
  })
})

describe('formatAutoUpdateErrorMessage', () => {
  it('maps each class to friendly copy', () => {
    expect(formatAutoUpdateErrorMessage(new Error('ERR_HTTP2_SERVER_REFUSED_STREAM'))).toMatch(/refused the download stream/i)
    expect(formatAutoUpdateErrorMessage(new Error('Error: 503 releases.atom github.com'))).toMatch(/GitHub temporarily failed/i)
    expect(formatAutoUpdateErrorMessage(new Error('Request timed out'))).toMatch(/timed out/i)
    expect(formatAutoUpdateErrorMessage(new Error('ECONNRESET'))).toMatch(/temporary network error/i)
  })
  it('falls back to the summarized first line', () => {
    expect(formatAutoUpdateErrorMessage(new Error('Weird thing happened\nstack line'))).toBe('Weird thing happened')
  })
})
