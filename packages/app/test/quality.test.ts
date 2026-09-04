import { describe, it, expect } from 'vitest'
import { qualityOf, qualityPatchOf, qualityViewOf } from '../src/main/quality.js'
import { DEFAULT_SETTINGS } from '../src/main/StreamSettings.js'

const s = (over: Partial<typeof DEFAULT_SETTINGS> = {}) => ({ ...DEFAULT_SETTINGS, ...over })

describe('qualityOf', () => {
  it('resolves auto to the shipped defaults: a 1440 cap at 60fps, bitrate from the table', () => {
    expect(qualityOf(s())).toEqual({ maxHeight: 1440, fps: 60, overrides: { videoBitrateKbps: null } })
  })

  it('passes each override through when the user set one', () => {
    expect(qualityOf(s({ qualityHeight: 720, qualityFps: 30, qualityBitrateKbps: 4500 })))
      .toEqual({ maxHeight: 720, fps: 30, overrides: { videoBitrateKbps: 4500 } })
  })

  it('resolves each field independently — a custom fps leaves resolution on auto', () => {
    expect(qualityOf(s({ qualityFps: 30 }))).toEqual({ maxHeight: 1440, fps: 30, overrides: { videoBitrateKbps: null } })
  })
})

describe('qualityViewOf', () => {
  it('maps settings fields to the renderer vocabulary', () => {
    expect(qualityViewOf(s({ qualityHeight: 1080, qualityFps: null, qualityBitrateKbps: 9000, encoder: 'x264', encoderAuto: true })))
      .toEqual({ height: 1080, fps: null, bitrateKbps: 9000, encoder: 'x264', encoderAuto: true })
  })

  it('reports a stock install as fully auto', () => {
    expect(qualityViewOf(s())).toEqual({ height: null, fps: null, bitrateKbps: null, encoder: 'auto', encoderAuto: false })
  })

  it('surfaces the encoder selection and whether the app chose it', () => {
    const v = qualityViewOf({ ...DEFAULT_SETTINGS, encoder: 'x264', encoderAuto: true })
    expect(v).toMatchObject({ encoder: 'x264', encoderAuto: true })
  })
})

describe('qualityPatchOf', () => {
  it('writes every field when the renderer sends all of them', () => {
    expect(qualityPatchOf({ height: 1080, fps: 30, bitrateKbps: 6000, encoder: 'nvenc_h264' }))
      .toEqual({ qualityHeight: 1080, qualityFps: 30, qualityBitrateKbps: 6000, encoder: 'nvenc_h264', encoderAuto: false })
  })

  it('touches nothing for an empty patch — absent keys are left alone', () => {
    expect(qualityPatchOf({})).toEqual({})
  })

  it('writes only the key that is present', () => {
    expect(qualityPatchOf({ fps: 30 })).toEqual({ qualityFps: 30 })
    expect(qualityPatchOf({ height: 720 })).toEqual({ qualityHeight: 720 })
    expect(qualityPatchOf({ bitrateKbps: 4500 })).toEqual({ qualityBitrateKbps: 4500 })
  })

  it('clears a field back to auto when the key is present as null', () => {
    expect(qualityPatchOf({ height: null })).toEqual({ qualityHeight: null })
    expect(qualityPatchOf({ fps: null })).toEqual({ qualityFps: null })
    expect(qualityPatchOf({ bitrateKbps: null })).toEqual({ qualityBitrateKbps: null })
  })

  it('writes the encoder and clears the app-chose-it explanation', () => {
    // A user touching the picker takes ownership of the choice, so the
    // "AxiStream switched this for you" note stops applying.
    expect(qualityPatchOf({ encoder: 'nvenc_h264' })).toEqual({ encoder: 'nvenc_h264', encoderAuto: false })
  })

  it('leaves the encoder alone when the key is absent', () => {
    expect(qualityPatchOf({ height: 1080 })).toEqual({ qualityHeight: 1080 })
  })
})
