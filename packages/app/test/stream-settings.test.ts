import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StreamSettings, DEFAULT_SETTINGS, sanitizeMasks, sanitizeGameAudioApps, sanitizeWebcam } from '../src/main/StreamSettings.js'
import { DEFAULT_WEBCAM } from '../src/shared/state.js'

let file: string
beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), 'axi-')), 'stream.json') })

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'axi-')), 'stream.json')

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

  describe('encoder', () => {
    it('defaults to auto and round-trips', () => {
      const s = new StreamSettings(file)
      expect(s.load().encoder).toBe('auto')
      s.patch({ encoder: 'x264' })
      expect(s.load().encoder).toBe('x264')
    })

    it('non-string value falls back to auto', () => {
      writeFileSync(file, JSON.stringify({ encoder: 42 }))
      const s = new StreamSettings(file)
      expect(s.load().encoder).toBe('auto')
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

  it('defaults pttModifier to none, round-trips it, and sanitizes garbage', () => {
    const s = new StreamSettings(file)
    expect(s.load().pttModifier).toBe('')
    s.patch({ pttModifier: 'ctrl' })
    expect(new StreamSettings(file).load().pttModifier).toBe('ctrl')
    s.save({ ...DEFAULT_SETTINGS, pttModifier: 'hyper' as never })
    expect(new StreamSettings(file).load().pttModifier).toBe('')
  })

  it('defaults lastSeenVersion to empty and round-trips it', () => {
    const s = new StreamSettings(file)
    expect(s.load().lastSeenVersion).toBe('')
    s.patch({ lastSeenVersion: '0.1.4' })
    expect(new StreamSettings(file).load().lastSeenVersion).toBe('0.1.4')
  })

  it('defaults recordDir to empty for a settings file written before recording existed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'axi-settings-'))
    const f = join(dir, 'settings.json')
    writeFileSync(f, JSON.stringify({ titleTemplate: 'x', privacy: 'public' }))
    const s = new StreamSettings(f)

    expect(s.load().recordDir).toBe('')
  })

  it('persists a recordDir through patch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'axi-settings-'))
    const s = new StreamSettings(join(dir, 'settings.json'))

    s.patch({ recordDir: '/home/u/Videos/AxiStream' })

    expect(s.load().recordDir).toBe('/home/u/Videos/AxiStream')
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

describe('webcam settings', () => {
  it('defaults to a disabled bottom-right webcam', () => {
    const s = new StreamSettings(tmpFile())
    expect(s.load().webcam).toEqual({
      enabled: false, deviceId: null, deviceLabel: null,
      corner: 'br', sizePct: 0.22, mirrored: false, mode: null,
    })
  })

  it('defaults the webcam for a settings file written before webcams existed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'axi-settings-'))
    const f = join(dir, 'settings.json')
    writeFileSync(f, JSON.stringify({ titleTemplate: 'x', privacy: 'public' }))

    expect(new StreamSettings(f).load().webcam).toEqual({
      enabled: false, deviceId: null, deviceLabel: null,
      corner: 'br', sizePct: 0.22, mirrored: false, mode: null,
    })
  })

  it('round-trips a configured webcam', () => {
    const s = new StreamSettings(tmpFile())
    s.patch({ webcam: { enabled: true, deviceId: '/dev/video0', deviceLabel: 'C920', corner: 'tl', sizePct: 0.3, mirrored: true, mode: null } })
    expect(s.load().webcam.deviceId).toBe('/dev/video0')
    expect(s.load().webcam.corner).toBe('tl')
    expect(s.load().webcam.mirrored).toBe(true)
  })

  it('clamps an out-of-range sizePct and rejects a bogus corner', () => {
    expect(sanitizeWebcam({ sizePct: 0.9, corner: 'middle' })).toMatchObject({ sizePct: 0.35, corner: 'br' })
    expect(sanitizeWebcam({ sizePct: 0.01 })).toMatchObject({ sizePct: 0.15 })
  })

  it('drops a partial mode rather than half-applying it', () => {
    expect(sanitizeWebcam({ mode: { resolution: '1920x1080' } }).mode).toBeNull()
    expect(sanitizeWebcam({ mode: { pixelformat: '1196444237', resolution: '5', framerate: '3' } }).mode)
      .toEqual({ pixelformat: '1196444237', resolution: '5', framerate: '3' })
  })

  it('falls back to defaults for a non-object webcam value', () => {
    expect(sanitizeWebcam(null)).toEqual(DEFAULT_WEBCAM)
    expect(sanitizeWebcam('nope')).toEqual(DEFAULT_WEBCAM)
  })
})

describe('StreamSettings quality fields', () => {
  it('defaults every quality field to auto', () => {
    const d = new StreamSettings(file).load()

    expect(d.qualityHeight).toBeNull()
    expect(d.qualityFps).toBeNull()
    expect(d.qualityBitrateKbps).toBeNull()
    expect(d.encoderAuto).toBe(false)
  })

  it('round-trips valid quality values', () => {
    new StreamSettings(file).patch({ qualityHeight: 720, qualityFps: 30, qualityBitrateKbps: 4500, encoderAuto: true })

    const d = new StreamSettings(file).load()
    expect(d.qualityHeight).toBe(720)
    expect(d.qualityFps).toBe(30)
    expect(d.qualityBitrateKbps).toBe(4500)
    expect(d.encoderAuto).toBe(true)
  })

  it('reverts an off-list height or fps to auto rather than encoding something impossible', () => {
    new StreamSettings(file).patch({ qualityHeight: 999, qualityFps: 144 })

    const d = new StreamSettings(file).load()
    expect(d.qualityHeight).toBeNull()
    expect(d.qualityFps).toBeNull()
  })

  it('clamps bitrate into the ingest range instead of dropping it', () => {
    const s = new StreamSettings(file)

    s.patch({ qualityBitrateKbps: 60000 })
    expect(s.load().qualityBitrateKbps).toBe(51000)

    s.patch({ qualityBitrateKbps: 10 })
    expect(s.load().qualityBitrateKbps).toBe(1000)
  })

  it('treats a non-numeric bitrate as auto', () => {
    const s = new StreamSettings(file)

    s.patch({ qualityBitrateKbps: 'fast' as unknown as number })

    expect(s.load().qualityBitrateKbps).toBeNull()
  })

  it('loads a settings file written before this feature as fully auto', () => {
    const older = tmpFile()
    writeFileSync(older, JSON.stringify({ titleTemplate: 'x', gameAudioApps: [], preferSoftware: true }))

    const d = new StreamSettings(older).load()
    expect(d.qualityHeight).toBeNull()
    expect(d.qualityFps).toBeNull()
    expect(d.qualityBitrateKbps).toBeNull()
    expect(d.encoder).toBe('x264')
    expect(d.encoderAuto).toBe(false)
  })
})

describe('encoder settings migration', () => {
  const loadSettingsFrom = (raw: Record<string, unknown>) => {
    const f = tmpFile()
    writeFileSync(f, JSON.stringify(raw))
    return new StreamSettings(f).load()
  }

  it('defaults to auto when nothing is stored', () => {
    const s = loadSettingsFrom({})
    expect(s.encoder).toBe('auto')
    expect(s.encoderAuto).toBe(false)
  })

  // The old boolean meant exactly "force x264".
  it('migrates preferSoftware: true to an explicit x264 selection', () => {
    const s = loadSettingsFrom({ preferSoftware: true, preferSoftwareAuto: true })
    expect(s.encoder).toBe('x264')
    expect(s.encoderAuto).toBe(true)
  })

  it('migrates preferSoftware: false to auto', () => {
    const s = loadSettingsFrom({ preferSoftware: false, preferSoftwareAuto: false })
    expect(s.encoder).toBe('auto')
    expect(s.encoderAuto).toBe(false)
  })

  it('prefers a stored encoder id over the legacy boolean', () => {
    const s = loadSettingsFrom({ encoder: 'nvenc_h264', preferSoftware: true })
    expect(s.encoder).toBe('nvenc_h264')
  })

  it('rejects an unknown encoder id rather than trusting the file', () => {
    expect(loadSettingsFrom({ encoder: 'nvenc_vp9' }).encoder).toBe('auto')
    expect(loadSettingsFrom({ encoder: 42 }).encoder).toBe('auto')
  })
})

describe('hotkeys persistence', () => {
  const loadWith = (obj: unknown) => {
    const f = tmpFile()
    writeFileSync(f, JSON.stringify(obj))
    return new StreamSettings(f).load()
  }

  it('defaults every action to unbound', () => {
    const s = loadWith({})
    expect(s.hotkeys).toEqual({ goLive: null, micMute: null, masks: null, record: null })
  })

  it('round-trips a valid binding', () => {
    const s = loadWith({ hotkeys: { goLive: { code: 183, name: 'F13', modifier: 'ctrl' }, micMute: null, masks: null, record: null } })
    expect(s.hotkeys.goLive).toEqual({ code: 183, name: 'F13', modifier: 'ctrl' })
  })

  it('drops a malformed entry to null rather than to a key', () => {
    const s = loadWith({ hotkeys: { goLive: { code: 'nope', name: 'F13', modifier: '' }, micMute: null, masks: null, record: null } })
    expect(s.hotkeys.goLive).toBeNull()
  })

  it('drops an out-of-range keycode to null', () => {
    const s = loadWith({ hotkeys: { goLive: { code: 9999, name: 'X', modifier: '' }, micMute: null, masks: null, record: null } })
    expect(s.hotkeys.goLive).toBeNull()
  })

  it('drops an unknown modifier to null', () => {
    const s = loadWith({ hotkeys: { goLive: { code: 183, name: 'F13', modifier: 'hyper' }, micMute: null, masks: null, record: null } })
    expect(s.hotkeys.goLive).toBeNull()
  })

  it('survives hotkeys being a non-object', () => {
    const s = loadWith({ hotkeys: 'yes' })
    expect(s.hotkeys).toEqual({ goLive: null, micMute: null, masks: null, record: null })
  })

  it('fills in a missing action key', () => {
    const s = loadWith({ hotkeys: { goLive: { code: 183, name: 'F13', modifier: '' } } })
    expect(s.hotkeys.record).toBeNull()
  })
})
