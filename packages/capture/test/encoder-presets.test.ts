import { describe, it, expect } from 'vitest'
import { choosePreset } from '../src/encoder-presets.js'

describe('choosePreset', () => {
  it('maps encoder kinds to simple-mode ini values and labels', () => {
    expect(choosePreset('nvenc', 1080, 60)).toMatchObject({ streamEncoder: 'nvenc', label: 'NVENC' })
    expect(choosePreset('vaapi', 1080, 60)).toMatchObject({ streamEncoder: 'ffmpeg_vaapi', label: 'VAAPI' })
    expect(choosePreset('x264', 1080, 60)).toMatchObject({ streamEncoder: 'x264', label: 'x264' })
  })

  it('picks bitrate from the height/fps table', () => {
    expect(choosePreset('x264', 1440, 60).videoBitrateKbps).toBe(24000)
    expect(choosePreset('x264', 1440, 30).videoBitrateKbps).toBe(13000)
    expect(choosePreset('x264', 1080, 50).videoBitrateKbps).toBe(9000)
    expect(choosePreset('x264', 1080, 30).videoBitrateKbps).toBe(6000)
    expect(choosePreset('x264', 720, 60).videoBitrateKbps).toBe(6000)
    expect(choosePreset('x264', 720, 49).videoBitrateKbps).toBe(4000)
    expect(choosePreset('x264', 480, 60).videoBitrateKbps).toBe(2500)
    expect(choosePreset('x264', 480, 30).videoBitrateKbps).toBe(2500)
  })

  it('taller-than-1440 canvases use the 1440 tier', () => {
    expect(choosePreset('nvenc', 2160, 60).videoBitrateKbps).toBe(24000)
  })

  it('audio is always 160 kbps', () => {
    expect(choosePreset('nvenc', 1440, 60).audioBitrateKbps).toBe(160)
    expect(choosePreset('x264', 480, 30).audioBitrateKbps).toBe(160)
  })
})
