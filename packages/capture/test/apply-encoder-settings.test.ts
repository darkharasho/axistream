import { describe, it, expect, vi } from 'vitest'
import { applyEncoderSettings } from '../src/apply-encoder-settings.js'
import { choosePreset } from '../src/encoder-presets.js'

describe('applyEncoderSettings', () => {
  it('writes mode, encoder, and bitrates as profile parameters', async () => {
    const calls: any[] = []
    const call = vi.fn(async (req: string, params?: object) => { calls.push({ req, params }) })
    const ok = await applyEncoderSettings({ call }, choosePreset('nvenc', 1440, 60))
    expect(ok).toBe(true)
    expect(calls).toEqual([
      { req: 'SetProfileParameter', params: { parameterCategory: 'Output', parameterName: 'Mode', parameterValue: 'Simple' } },
      { req: 'SetProfileParameter', params: { parameterCategory: 'SimpleOutput', parameterName: 'StreamEncoder', parameterValue: 'nvenc' } },
      { req: 'SetProfileParameter', params: { parameterCategory: 'SimpleOutput', parameterName: 'VBitrate', parameterValue: '24000' } },
      { req: 'SetProfileParameter', params: { parameterCategory: 'SimpleOutput', parameterName: 'ABitrate', parameterValue: '160' } },
    ])
  })

  it('returns false (never throws) when calls keep failing', async () => {
    const call = vi.fn(async () => { throw new Error('code 600') })
    const ok = await applyEncoderSettings({ call, tries: 2, delayMs: 1 }, choosePreset('x264', 1080, 60))
    expect(ok).toBe(false)
  })
})
