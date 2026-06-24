import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}

export class KeyStore {
  constructor(private readonly filePath: string, private readonly safe: SafeStorageLike) {}

  canPersist(): boolean { return this.safe.isEncryptionAvailable() }

  save(key: string): void {
    if (!this.canPersist()) return
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, this.safe.encryptString(key))
  }

  load(): string | null {
    if (!existsSync(this.filePath) || !this.canPersist()) return null
    try { return this.safe.decryptString(readFileSync(this.filePath)) } catch { return null }
  }

  forget(): void { try { rmSync(this.filePath, { force: true }) } catch { /* ignore */ } }

  masked(): string | null {
    const k = this.load()
    return k ? '····' + k.slice(-4) : null
  }
}
