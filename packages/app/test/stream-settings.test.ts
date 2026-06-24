import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StreamSettings, DEFAULT_SETTINGS } from '../src/main/StreamSettings.js'

let file: string
beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), 'axi-')), 'stream.json') })

describe('StreamSettings', () => {
  it('returns defaults when no file exists', () => {
    expect(new StreamSettings(file).load()).toEqual(DEFAULT_SETTINGS)
  })

  it('persists a patch and reloads it', () => {
    const s = new StreamSettings(file)
    s.patch({ titleTemplate: 'EWW Raid - {{date}}', privacy: 'unlisted' })
    const reloaded = new StreamSettings(file).load()
    expect(reloaded.titleTemplate).toBe('EWW Raid - {{date}}')
    expect(reloaded.privacy).toBe('unlisted')
  })

  it('bumpCounter increments and persists', () => {
    const s = new StreamSettings(file)
    expect(s.bumpCounter()).toBe(1)
    expect(s.bumpCounter()).toBe(2)
    expect(new StreamSettings(file).load().counter).toBe(2)
  })

  it('falls back to defaults on corrupt json', () => {
    const s = new StreamSettings(file)
    s.save({ ...DEFAULT_SETTINGS, privacy: 'private' })
    // simulate corruption
    writeFileSync(file, '{not json')
    expect(new StreamSettings(file).load()).toEqual(DEFAULT_SETTINGS)
  })
})
