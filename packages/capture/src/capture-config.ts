import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type ProvisionStatus =
  | 'UNPROVISIONED' | 'BUILDING' | 'AWAITING_APPROVAL' | 'READY' | 'REPAIR'

export const CAPTURE_CONFIG_SCHEMA = 2 as const

export interface CaptureTarget {
  property: string
  value: string | number
  label: string
}

export interface CaptureConfigData {
  schema: typeof CAPTURE_CONFIG_SCHEMA
  engineId: string
  provisioned: boolean
  platform: NodeJS.Platform
  target?: CaptureTarget
  collection: string
}

export const DEFAULT_CONFIG = (platform: NodeJS.Platform, engineId = ''): CaptureConfigData => ({
  schema: CAPTURE_CONFIG_SCHEMA,
  engineId,
  provisioned: false,
  platform,
  collection: 'AxiStream',
})

export class CaptureConfig {
  constructor(private readonly filePath: string, private readonly engineId = '') {}

  load(): CaptureConfigData {
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (!isCaptureConfigData(raw, this.engineId)) {
        return DEFAULT_CONFIG(process.platform, this.engineId)
      }
      return raw
    } catch {
      return DEFAULT_CONFIG(process.platform, this.engineId)
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

function isCaptureConfigData(value: unknown, engineId: string): value is CaptureConfigData {
  if (!value || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  if (
    raw['schema'] !== CAPTURE_CONFIG_SCHEMA ||
    raw['engineId'] !== engineId ||
    typeof raw['provisioned'] !== 'boolean' ||
    typeof raw['platform'] !== 'string' ||
    typeof raw['collection'] !== 'string'
  ) return false
  const target = raw['target']
  if (target === undefined) return true
  if (!target || typeof target !== 'object') return false
  const t = target as Record<string, unknown>
  return typeof t['property'] === 'string' &&
    (typeof t['value'] === 'string' || typeof t['value'] === 'number') &&
    typeof t['label'] === 'string'
}
