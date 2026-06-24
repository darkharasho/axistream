import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { base64url, createPkce, randomState } from '../src/main/pkce.js'

describe('pkce', () => {
  it('challenge is base64url sha256 of verifier', () => {
    const { verifier, challenge } = createPkce()
    const expected = base64url(createHash('sha256').update(verifier).digest())
    expect(challenge).toBe(expected)
  })

  it('verifier is url-safe and long enough', () => {
    const { verifier } = createPkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
  })

  it('state is random and url-safe', () => {
    expect(randomState()).not.toBe(randomState())
    expect(randomState()).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
