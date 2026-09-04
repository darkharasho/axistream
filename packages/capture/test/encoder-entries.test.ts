import { describe, it, expect } from 'vitest'
import { OBS_SIMPLE_ENCODERS } from '../src/encoder-presets.js'
import { ENCODER_ENTRIES, encoderAvailability, encoderEntry } from '../src/encoder-entries.js'

const linux = 'linux' as NodeJS.Platform
const win = 'win32' as NodeJS.Platform

describe('ENCODER_ENTRIES', () => {
  it('covers every row of the OBS dropdown the request asked for', () => {
    expect(ENCODER_ENTRIES.map((e) => e.id)).toEqual([
      'x264', 'nvenc_h264', 'nvenc_hevc', 'nvenc_av1', 'amd_h264', 'amd_hevc', 'vaapi_h264',
    ])
  })

  it('only emits stream encoder strings OBS recognizes', () => {
    for (const e of ENCODER_ENTRIES) {
      if (e.streamEncoder !== null) expect(OBS_SIMPLE_ENCODERS).toContain(e.streamEncoder)
    }
  })

  it('looks entries up by id', () => {
    expect(encoderEntry('nvenc_av1').streamEncoder).toBe('nvenc_av1')
  })
})

describe('encoderAvailability', () => {
  const of = (id: Parameters<typeof encoderEntry>[0]) => encoderEntry(id)

  it('software always works', () => {
    expect(encoderAvailability(of('x264'), 'none', linux)).toBe('ok')
    expect(encoderAvailability(of('x264'), 'nvidia', win)).toBe('ok')
  })

  it('NVENC H.264 needs an NVIDIA GPU', () => {
    expect(encoderAvailability(of('nvenc_h264'), 'nvidia', linux)).toBe('ok')
    expect(encoderAvailability(of('nvenc_h264'), 'amd-intel', linux)).toBe('no-nvidia')
    expect(encoderAvailability(of('nvenc_h264'), 'none', linux)).toBe('no-nvidia')
  })

  it('HEVC and AV1 are blocked by the RTMP ingest even on the right GPU', () => {
    expect(encoderAvailability(of('nvenc_hevc'), 'nvidia', linux)).toBe('enhanced-rtmp')
    expect(encoderAvailability(of('nvenc_av1'), 'nvidia', linux)).toBe('enhanced-rtmp')
  })

  it('reports the missing GPU before the ingest limit — the more actionable reason', () => {
    expect(encoderAvailability(of('nvenc_av1'), 'amd-intel', linux)).toBe('no-nvidia')
  })

  it('AMF is Windows-only, whatever the GPU', () => {
    expect(encoderAvailability(of('amd_h264'), 'amd-intel', linux)).toBe('amf-windows-only')
    expect(encoderAvailability(of('amd_h264'), 'amd-intel', win)).toBe('ok')
    expect(encoderAvailability(of('amd_h264'), 'nvidia', win)).toBe('no-amd')
    expect(encoderAvailability(of('amd_hevc'), 'amd-intel', win)).toBe('enhanced-rtmp')
  })

  it('VAAPI is never selectable until advanced output mode lands', () => {
    expect(encoderAvailability(of('vaapi_h264'), 'amd-intel', linux)).toBe('vaapi-advanced-mode')
    expect(encoderAvailability(of('vaapi_h264'), 'nvidia', linux)).toBe('vaapi-advanced-mode')
  })
})
