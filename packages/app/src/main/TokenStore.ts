import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  channelTitle: string | null
}

export class TokenStore {
  constructor(private readonly filePath: string, private readonly safe: SafeStorageLike) {}

  canPersist(): boolean { return this.safe.isEncryptionAvailable() }

  save(t: OAuthTokens): void {
    if (!this.canPersist()) return
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, this.safe.encryptString(JSON.stringify(t)))
  }

  load(): OAuthTokens | null {
    if (!existsSync(this.filePath) || !this.canPersist()) return null
    try { return JSON.parse(this.safe.decryptString(readFileSync(this.filePath))) as OAuthTokens }
    catch { return null }
  }

  forget(): void { try { rmSync(this.filePath, { force: true }) } catch { /* ignore */ } }
}
