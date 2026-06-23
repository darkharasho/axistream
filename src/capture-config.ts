import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type ProvisionStatus =
  | 'UNPROVISIONED' | 'BUILDING' | 'AWAITING_APPROVAL' | 'READY' | 'REPAIR'

export interface CaptureTarget { displayId?: string; name?: string }

export interface CaptureConfigData {
  provisioned: boolean
  platform: NodeJS.Platform
  target?: CaptureTarget
  collection: string
}

export const DEFAULT_CONFIG = (platform: NodeJS.Platform): CaptureConfigData => ({
  provisioned: false,
  platform,
  collection: 'AxiStream',
})

export class CaptureConfig {
  constructor(private readonly filePath: string) {}

  load(): CaptureConfigData {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (typeof raw?.provisioned !== 'boolean' || typeof raw?.collection !== 'string') {
        return DEFAULT_CONFIG(process.platform)
      }
      return raw as CaptureConfigData
    } catch {
      return DEFAULT_CONFIG(process.platform)
    }
  }

  save(data: CaptureConfigData): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(data, null, 2))
  }

  isProvisioned(): boolean {
    return this.load().provisioned
  }
}
