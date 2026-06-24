import { describe, it, expect } from 'vitest'
import { createLoopback } from '../src/main/loopback.js'

describe('createLoopback', () => {
  it('captures code+state from the redirect request', async () => {
    const lb = await createLoopback()
    expect(lb.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    const codePromise = lb.waitForCode()
    // hit the loopback as the browser would
    await fetch(`${lb.redirectUri}?code=ABC&state=XYZ`)
    const got = await codePromise
    expect(got).toEqual({ code: 'ABC', state: 'XYZ' })
    lb.close()
  })
})
