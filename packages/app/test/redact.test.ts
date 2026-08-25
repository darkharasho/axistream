import { describe, it, expect } from 'vitest'
import { scrubLine, pickState } from '../src/main/redact.js'
import { INITIAL_STATE } from '../src/shared/state.js'

describe('scrubLine', () => {
  it('redacts Discord webhook URLs', () => {
    const out = scrubLine('POST https://discord.com/api/webhooks/123456/AbCdEf-_xyz failed')
    expect(out).toContain('<redacted>')
    expect(out).not.toContain('AbCdEf-_xyz')
  })

  it('redacts discordapp.com webhooks too', () => {
    expect(scrubLine('https://discordapp.com/api/webhooks/9/zzz')).not.toContain('zzz')
  })

  it('redacts bearer tokens', () => {
    expect(scrubLine('Authorization: Bearer ya29.a0Af')).toBe('Authorization: Bearer <redacted>')
  })

  it('redacts key query parameters', () => {
    expect(scrubLine('rtmp://a.rtmp.youtube.com/live2?key=abcd-1234')).toContain('key=<redacted>')
  })

  it('redacts the YouTube stream-key shape', () => {
    expect(scrubLine('using w1x2-y3z4-a5b6-c7d8-e9f0 now')).toContain('<redacted-stream-key>')
  })

  it('replaces the home directory with ~', () => {
    const home = process.env.HOME ?? ''
    if (!home) return
    expect(scrubLine(`reading ${home}/.var/app/x`)).toBe('reading ~/.var/app/x')
  })

  // A literal replace cannot be defeated by metacharacters; a regex could.
  it('replaces a home path containing regex metacharacters', () => {
    expect(scrubLine('at /home/a+b(c)/x', '/home/a+b(c)')).toBe('at ~/x')
  })

  it('leaves ordinary lines untouched', () => {
    expect(scrubLine('capture started at 1920x1080')).toBe('capture started at 1920x1080')
  })
})

describe('pickState', () => {
  it('includes diagnostic fields', () => {
    const out = pickState({ ...INITIAL_STATE, encoder: 'nvenc', videoBitrateKbps: 8000 })
    expect(out.encoder).toBe('nvenc')
    expect(out.videoBitrateKbps).toBe(8000)
    expect(out.phase).toBe('SETTING_UP')
  })

  it('omits every secret-bearing field', () => {
    const out = pickState({
      ...INITIAL_STATE,
      watchUrl: 'https://youtube.com/watch?v=secret',
      youtube: { connected: true, channel: 'Someone' },
      settings: { ...INITIAL_STATE.settings, discordWebhookUrl: 'https://discord.com/api/webhooks/1/x', discordMessage: 'hi' },
    })
    const json = JSON.stringify(out)
    expect(json).not.toContain('secret')
    expect(json).not.toContain('Someone')
    expect(json).not.toContain('webhooks')
    expect(json).not.toContain('hi')
    // connected is safe and useful; the channel name is not.
    expect(out.youtube).toEqual({ connected: true })
  })

  // The allowlist is the point: new AppState fields must not auto-ship.
  it('ignores fields it does not know about', () => {
    const out = pickState({ ...INITIAL_STATE, brandNewSecret: 'nope' } as never)
    expect(JSON.stringify(out)).not.toContain('nope')
  })
})
