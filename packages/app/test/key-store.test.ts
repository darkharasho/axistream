import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KeyStore, type SafeStorageLike } from '../src/main/KeyStore.js'

// Fake safeStorage that XORs — enough to prove encrypt/decrypt round-trips and
// that the plaintext key is not written to disk verbatim.
function fakeSafe(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
    decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString(),
  }
}

describe('KeyStore', () => {
  let dir: string, file: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'aks-')); file = join(dir, 'key.bin') })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('round-trips a key and masks it', () => {
    const ks = new KeyStore(file, fakeSafe())
    ks.save('xxxx-yyyy-zzzz-7f3a')
    expect(ks.load()).toBe('xxxx-yyyy-zzzz-7f3a')
    expect(ks.masked()).toBe('····7f3a')
  })
  it('does not write the plaintext key to disk', () => {
    const ks = new KeyStore(file, fakeSafe())
    ks.save('SECRET-KEY-7f3a')
    const raw = require('node:fs').readFileSync(file)
    expect(raw.toString()).not.toContain('SECRET-KEY')
  })
  it('forget() removes the stored key', () => {
    const ks = new KeyStore(file, fakeSafe())
    ks.save('abcd-7f3a'); ks.forget()
    expect(ks.load()).toBeNull()
    expect(existsSync(file)).toBe(false)
  })
  it('canPersist() is false and save is a no-op when encryption is unavailable', () => {
    const ks = new KeyStore(file, fakeSafe(false))
    expect(ks.canPersist()).toBe(false)
    ks.save('abcd-7f3a')
    expect(existsSync(file)).toBe(false)
    expect(ks.load()).toBeNull()
  })
})
