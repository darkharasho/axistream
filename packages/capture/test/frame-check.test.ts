import { describe, it, expect } from 'vitest'
import { isNonBlackPng } from '../src/frame-check.js'

describe('isNonBlackPng', () => {
  it('rejects tiny/empty buffers', () => {
    expect(isNonBlackPng(Buffer.alloc(0))).toBe(false)
    expect(isNonBlackPng(Buffer.alloc(100, 0))).toBe(false)
  })

  it('rejects a large but uniform (all-same-byte) buffer', () => {
    expect(isNonBlackPng(Buffer.alloc(5000, 0))).toBe(false)
  })

  it('accepts a large, high-variety buffer', () => {
    const buf = Buffer.alloc(5000)
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 37) % 251
    expect(isNonBlackPng(buf)).toBe(true)
  })
})
