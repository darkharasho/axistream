import { describe, it, expect } from 'vitest'
import { presetFor, resolveEncoder } from '../src/encoder-presets.js'

describe('presetFor', () => {
  it('maps ids to OBS strings and chip labels', () => {
    expect(presetFor('nvenc_h264', 1080, 60)).toMatchObject({ streamEncoder: 'nvenc', label: 'NVENC H.264' })
    expect(presetFor('x264', 1080, 60)).toMatchObject({ streamEncoder: 'x264', label: 'x264' })
  })

  it('picks bitrate from the height/fps table', () => {
    expect(presetFor('x264', 1440, 60).videoBitrateKbps).toBe(24000)
    expect(presetFor('x264', 1440, 30).videoBitrateKbps).toBe(13000)
    expect(presetFor('x264', 1080, 50).videoBitrateKbps).toBe(9000)
    expect(presetFor('x264', 1080, 30).videoBitrateKbps).toBe(6000)
    expect(presetFor('x264', 720, 60).videoBitrateKbps).toBe(6000)
    expect(presetFor('x264', 720, 49).videoBitrateKbps).toBe(4000)
    expect(presetFor('x264', 480, 60).videoBitrateKbps).toBe(2500)
    expect(presetFor('x264', 480, 30).videoBitrateKbps).toBe(2500)
  })

  it('taller-than-1440 canvases use the 1440 tier', () => {
    expect(presetFor('nvenc_h264', 2160, 60).videoBitrateKbps).toBe(24000)
  })

  it('audio is always 160 kbps', () => {
    expect(presetFor('nvenc_h264', 1440, 60).audioBitrateKbps).toBe(160)
    expect(presetFor('x264', 480, 30).audioBitrateKbps).toBe(160)
  })

  it('uses an explicit bitrate override instead of the height/fps table', () => {
    expect(presetFor('nvenc_h264', 1080, 60, { videoBitrateKbps: 4500 }).videoBitrateKbps).toBe(4500)
    expect(presetFor('x264', 720, 30, { videoBitrateKbps: 20000 }).videoBitrateKbps).toBe(20000)
  })

  it('falls back to the table when the override is null, undefined, or absent', () => {
    expect(presetFor('x264', 1080, 60, { videoBitrateKbps: null }).videoBitrateKbps).toBe(9000)
    expect(presetFor('x264', 1080, 60, { videoBitrateKbps: undefined }).videoBitrateKbps).toBe(9000)
    expect(presetFor('x264', 1080, 60, {}).videoBitrateKbps).toBe(9000)
    expect(presetFor('x264', 1080, 60).videoBitrateKbps).toBe(9000)
  })

  it('leaves encoder identity and audio bitrate untouched by an override', () => {
    const p = presetFor('vaapi_h264', 1440, 60, { videoBitrateKbps: 3000 })
    expect(p).toMatchObject({ streamEncoder: 'x264', label: 'x264', audioBitrateKbps: 160 })
  })

  // resolveEncoder never returns 'vaapi_h264', but presetFor is exported and
  // can be called directly, bypassing it. The chip must never claim an
  // encoder that is not actually running — when the streamEncoder falls back
  // to x264, the label must too.
  it('never labels the x264 fallback as VAAPI', () => {
    expect(presetFor('vaapi_h264', 1080, 60)).toMatchObject({ streamEncoder: 'x264', label: 'x264' })
  })
})

describe('resolveEncoder', () => {
  const linux = 'linux' as NodeJS.Platform

  it('auto picks NVENC H.264 on an NVIDIA box', () => {
    expect(resolveEncoder('auto', 'nvidia', linux)).toBe('nvenc_h264')
  })

  it('auto falls back to software with no usable GPU', () => {
    expect(resolveEncoder('auto', 'amd-intel', linux)).toBe('x264')
    expect(resolveEncoder('auto', 'none', linux)).toBe('x264')
  })

  it('honors an explicit available selection', () => {
    expect(resolveEncoder('nvenc_h264', 'nvidia', linux)).toBe('nvenc_h264')
    expect(resolveEncoder('x264', 'nvidia', linux)).toBe('x264')
  })

  // A persisted id can outlive the GPU it was set on, or the ingest that
  // could carry it. Resolving rather than failing keeps go-live working.
  it('falls back when the stored selection is no longer available', () => {
    expect(resolveEncoder('nvenc_av1', 'nvidia', linux)).toBe('nvenc_h264')
    expect(resolveEncoder('nvenc_h264', 'amd-intel', linux)).toBe('x264')
    expect(resolveEncoder('vaapi_h264', 'amd-intel', linux)).toBe('x264')
  })
})
