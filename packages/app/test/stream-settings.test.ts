import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StreamSettings, DEFAULT_SETTINGS, sanitizeMasks, sanitizeGameAudioApps } from '../src/main/StreamSettings.js'

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

  it('defaults audio fields', () => {
    const s = new StreamSettings(file).load()
    expect(s.desktopEnabled).toBe(true)
    expect(s.micEnabled).toBe(false)
    expect(s.micDevice).toBe(null)
  })

  it('persists audio fields', () => {
    new StreamSettings(file).patch({ desktopEnabled: false, micEnabled: true, micDevice: 'alsa_input.pci-0000' })
    const r = new StreamSettings(file).load()
    expect(r.desktopEnabled).toBe(false)
    expect(r.micEnabled).toBe(true)
    expect(r.micDevice).toBe('alsa_input.pci-0000')
  })

  it('defaults desktopDevice to null and persists it', () => {
    expect(new StreamSettings(file).load().desktopDevice).toBe(null)
    new StreamSettings(file).patch({ desktopDevice: 'alsa_output.hdmi.monitor' })
    expect(new StreamSettings(file).load().desktopDevice).toBe('alsa_output.hdmi.monitor')
  })

  describe('masks', () => {
    it('defaults to [] and round-trips', () => {
      const s = new StreamSettings(file)
      expect(s.load().masks).toEqual([])
      s.patch({ masks: [{ id: 'a', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }] })
      expect(s.load().masks).toEqual([{ id: 'a', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }])
    })

    it('drops invalid entries and clamps values on load', () => {
      const s = new StreamSettings(file)
      writeFileSync(file, '{"masks":[{"id":"ok","x":-1,"y":2,"w":0,"h":5},{"id":42,"x":0,"y":0,"w":0.1,"h":0.1},{"id":"nan","x":null,"y":0,"w":0.1,"h":0.1},"garbage"]}')
      expect(s.load().masks).toEqual([{ id: 'ok', x: 0, y: 1, w: 0.01, h: 1 }])
    })

    it('caps at MAX_MASKS entries', () => {
      const s = new StreamSettings(file)
      const many = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, x: 0, y: 0, w: 0.1, h: 0.1 }))
      s.patch({ masks: many })
      expect(s.load().masks).toHaveLength(8)
    })

    it('non-array masks falls back to []', () => {
      const s = new StreamSettings(file)
      writeFileSync(file, '{"masks":"nope"}')
      expect(s.load().masks).toEqual([])
    })
  })

  describe('preferSoftware', () => {
    it('defaults to false and round-trips', () => {
      const s = new StreamSettings(file)
      expect(s.load().preferSoftware).toBe(false)
      s.patch({ preferSoftware: true })
      expect(s.load().preferSoftware).toBe(true)
    })

    it('non-boolean value falls back to false', () => {
      writeFileSync(file, JSON.stringify({ preferSoftware: 'yes' }))
      const s = new StreamSettings(file)
      expect(s.load().preferSoftware).toBe(false)
    })
  })

  describe('gameAudioApps', () => {
    it('defaults to [] and round-trips', () => {
      const s = new StreamSettings(file)
      expect(s.load().gameAudioApps).toEqual([])
      s.patch({ gameAudioApps: ['gw2-64.exe', 'Discord'] })
      expect(s.load().gameAudioApps).toEqual(['gw2-64.exe', 'Discord'])
    })

    it('sanitizes: trims, drops junk, dedupes, caps at 16', () => {
      writeFileSync(file, JSON.stringify({ gameAudioApps: [' gw2-64.exe ', '', 42, 'gw2-64.exe', ...Array.from({ length: 20 }, (_, i) => `app${i}`)] }))
      const apps = new StreamSettings(file).load().gameAudioApps
      expect(apps[0]).toBe('gw2-64.exe')
      expect(apps).toHaveLength(16)
      expect(new Set(apps).size).toBe(16)
    })

    it('migrates legacy enabled+target to a one-app list', () => {
      writeFileSync(file, JSON.stringify({ gameAudioEnabled: true, gameAudioTarget: 'gw2-64.exe' }))
      expect(new StreamSettings(file).load().gameAudioApps).toEqual(['gw2-64.exe'])
    })

    it('legacy disabled or empty target migrates to []', () => {
      writeFileSync(file, JSON.stringify({ gameAudioEnabled: false, gameAudioTarget: 'gw2-64.exe' }))
      expect(new StreamSettings(file).load().gameAudioApps).toEqual([])
      writeFileSync(file, JSON.stringify({ gameAudioEnabled: true, gameAudioTarget: '' }))
      expect(new StreamSettings(file).load().gameAudioApps).toEqual([])
    })

    it('new key present → legacy ignored', () => {
      writeFileSync(file, JSON.stringify({ gameAudioApps: ['Discord'], gameAudioEnabled: true, gameAudioTarget: 'gw2-64.exe' }))
      expect(new StreamSettings(file).load().gameAudioApps).toEqual(['Discord'])
    })

    it('legacy migration with desktopEnabled:true + gameAudioTarget forces desktopEnabled to false', () => {
      writeFileSync(file, JSON.stringify({ desktopEnabled: true, gameAudioEnabled: true, gameAudioTarget: 'gw2-64.exe' }))
      const s = new StreamSettings(file).load()
      expect(s.gameAudioApps).toEqual(['gw2-64.exe'])
      expect(s.desktopEnabled).toBe(false)
    })

    it('new key present → desktopEnabled is not touched by migration', () => {
      writeFileSync(file, JSON.stringify({ desktopEnabled: true, gameAudioApps: ['Discord'] }))
      const s = new StreamSettings(file).load()
      expect(s.gameAudioApps).toEqual(['Discord'])
      expect(s.desktopEnabled).toBe(true)
    })
  })

  describe('maskStyle', () => {
    it('defaults to box and round-trips blur', () => {
      const s = new StreamSettings(file)
      expect(s.load().maskStyle).toBe('box')
      s.patch({ maskStyle: 'blur' })
      expect(s.load().maskStyle).toBe('blur')
    })

    it('invalid value falls back to box', () => {
      writeFileSync(file, JSON.stringify({ maskStyle: 'plaid' }))
      expect(new StreamSettings(file).load().maskStyle).toBe('box')
    })
  })

  it('defaults the discord fields to empty and round-trips them', () => {
    const s = new StreamSettings(file)
    expect(s.load().discordWebhookUrl).toBe('')
    expect(s.load().discordMessage).toBe('')
    s.patch({ discordWebhookUrl: 'https://discord.com/api/webhooks/1/x', discordMessage: '@here' })
    const reloaded = new StreamSettings(file).load()
    expect(reloaded.discordWebhookUrl).toBe('https://discord.com/api/webhooks/1/x')
    expect(reloaded.discordMessage).toBe('@here')
  })

  it('sanitizes non-string discord fields to empty', () => {
    const s = new StreamSettings(file)
    s.save({ ...DEFAULT_SETTINGS, discordWebhookUrl: 123 as unknown as string, discordMessage: null as unknown as string })
    const loaded = new StreamSettings(file).load()
    expect(loaded.discordWebhookUrl).toBe('')
    expect(loaded.discordMessage).toBe('')
  })

  it('defaults pttEnabled to false, round-trips it, and sanitizes non-booleans', () => {
    const s = new StreamSettings(file)
    expect(s.load().pttEnabled).toBe(false)
    s.patch({ pttEnabled: true })
    expect(new StreamSettings(file).load().pttEnabled).toBe(true)
    s.save({ ...DEFAULT_SETTINGS, pttEnabled: 'yes' as unknown as boolean })
    expect(new StreamSettings(file).load().pttEnabled).toBe(false)
  })

  it('defaults the PTT key to F18/188, round-trips, and sanitizes garbage', () => {
    const s = new StreamSettings(file)
    expect(s.load().pttKeyCode).toBe(188)
    expect(s.load().pttKeyName).toBe('F18')
    s.patch({ pttKeyCode: 185, pttKeyName: 'F15' })
    const reloaded = new StreamSettings(file).load()
    expect(reloaded.pttKeyCode).toBe(185)
    expect(reloaded.pttKeyName).toBe('F15')
    s.save({ ...DEFAULT_SETTINGS, pttKeyCode: 9999 as never, pttKeyName: '' as never })
    const clean = new StreamSettings(file).load()
    expect(clean.pttKeyCode).toBe(188)
    expect(clean.pttKeyName).toBe('F18')
  })

  it('defaults lastSeenVersion to empty and round-trips it', () => {
    const s = new StreamSettings(file)
    expect(s.load().lastSeenVersion).toBe('')
    s.patch({ lastSeenVersion: '0.1.4' })
    expect(new StreamSettings(file).load().lastSeenVersion).toBe('0.1.4')
  })
})

describe('sanitizeMasks', () => {
  it('sanitizes a mixed array: valid, out-of-range, and garbage entries', () => {
    const input = [
      { id: 'valid', x: 0.2, y: 0.3, w: 0.4, h: 0.5 },
      { id: 'clamped', x: -0.5, y: 1.5, w: -1, h: 99 },
      'garbage',
    ]
    expect(sanitizeMasks(input)).toEqual([
      { id: 'valid', x: 0.2, y: 0.3, w: 0.4, h: 0.5 },
      { id: 'clamped', x: 0, y: 1, w: 0.01, h: 1 },
    ])
  })

  it('caps at MAX_MASKS (8) entries', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, x: 0.1, y: 0.1, w: 0.1, h: 0.1 }))
    expect(sanitizeMasks(many)).toHaveLength(8)
  })
})
