import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CAPTURE_CONFIG_SCHEMA, CaptureConfig, DEFAULT_CONFIG } from '../src/capture-config.js'

const ENGINE_ID = 'axistream-obs-windows-32.1.2'

describe('CaptureConfig', () => {
  let dir: string
  let file: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'axc-')); file = join(dir, 'capture.json') })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('returns default UNPROVISIONED config when file is missing', () => {
    const cfg = new CaptureConfig(file, ENGINE_ID)
    expect(cfg.load()).toEqual(DEFAULT_CONFIG(process.platform, ENGINE_ID))
    expect(cfg.isProvisioned()).toBe(false)
  })

  it('round-trips a saved config', () => {
    const cfg = new CaptureConfig(file, ENGINE_ID)
    const data = {
      schema: CAPTURE_CONFIG_SCHEMA,
      engineId: ENGINE_ID,
      provisioned: true,
      platform: process.platform,
      target: { property: 'monitor_id', value: '{DISPLAY-GUID}', label: 'Display 1' },
      collection: 'AxiStream' as const,
    }
    cfg.save(data)
    expect(new CaptureConfig(file, ENGINE_ID).load()).toEqual(data)
    expect(cfg.isProvisioned()).toBe(true)
  })

  it('falls back to default on corrupt file', () => {
    writeFileSync(file, '{not json')
    const cfg = new CaptureConfig(file, ENGINE_ID)
    expect(cfg.load()).toEqual(DEFAULT_CONFIG(process.platform, ENGINE_ID))
  })

  it('invalidates a legacy schema instead of trusting personal-OBS provisioning', () => {
    writeFileSync(file, JSON.stringify({
      provisioned: true,
      platform: process.platform,
      target: { displayId: '1' },
      collection: 'AxiStream',
    }))
    const cfg = new CaptureConfig(file, ENGINE_ID)
    expect(cfg.load()).toEqual(DEFAULT_CONFIG(process.platform, ENGINE_ID))
    expect(cfg.isProvisioned()).toBe(false)
  })

  it('invalidates config belonging to a different owned engine', () => {
    writeFileSync(file, JSON.stringify({
      schema: CAPTURE_CONFIG_SCHEMA,
      engineId: 'some-other-engine',
      provisioned: true,
      platform: process.platform,
      collection: 'AxiStream',
    }))
    const cfg = new CaptureConfig(file, ENGINE_ID)
    expect(cfg.load()).toEqual(DEFAULT_CONFIG(process.platform, ENGINE_ID))
    expect(cfg.isProvisioned()).toBe(false)
  })

  it('invalidates malformed target values', () => {
    writeFileSync(file, JSON.stringify({
      schema: CAPTURE_CONFIG_SCHEMA,
      engineId: ENGINE_ID,
      provisioned: true,
      platform: process.platform,
      target: { property: 'monitor_id', value: null, label: 'Display 1' },
      collection: 'AxiStream',
    }))
    expect(new CaptureConfig(file, ENGINE_ID).isProvisioned()).toBe(false)
  })
})
