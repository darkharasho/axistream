import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenStore } from '../src/main/TokenStore.js'

// Fake safeStorage: reversible XOR so we can prove no plaintext on disk.
const xor = (s: string) => Buffer.from([...Buffer.from(s, 'utf8')].map((b) => b ^ 0x5a))
const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => xor(s),
  decryptString: (b: Buffer) => xor(b.toString('utf8')).toString('utf8'),
}

let file: string
beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), 'axi-')), 'yt.bin') })

const sample = { accessToken: 'AT', refreshToken: 'RT', expiresAt: 1000, channelTitle: 'My Channel' }

describe('TokenStore', () => {
  it('round-trips tokens', () => {
    const s = new TokenStore(file, safe)
    s.save(sample)
    expect(new TokenStore(file, safe).load()).toEqual(sample)
  })

  it('does not write plaintext refresh token', () => {
    new TokenStore(file, safe).save(sample)
    expect(readFileSync(file, 'utf8')).not.toContain('RT')
  })

  it('returns null when missing', () => {
    expect(new TokenStore(file, safe).load()).toBeNull()
  })

  it('forget removes the file', () => {
    const s = new TokenStore(file, safe)
    s.save(sample)
    s.forget()
    expect(s.load()).toBeNull()
  })
})
