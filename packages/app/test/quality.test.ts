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
    expect(qualityViewOf(s({ qualityHeight: 1080, qualityFps: null, qualityBitrateKbps: 9000, preferSoftware: true, preferSoftwareAuto: true })))
      .toEqual({ height: 1080, fps: null, bitrateKbps: 9000, preferSoftware: true, preferSoftwareAuto: true })
  })

  it('reports a stock install as fully auto', () => {
    expect(qualityViewOf(s())).toEqual({ height: null, fps: null, bitrateKbps: null, preferSoftware: false, preferSoftwareAuto: false })
  })
})

describe('qualityPatchOf', () => {
  it('writes every field when the renderer sends all of them', () => {
    expect(qualityPatchOf({ height: 1080, fps: 30, bitrateKbps: 6000, preferSoftware: true }))
      .toEqual({ qualityHeight: 1080, qualityFps: 30, qualityBitrateKbps: 6000, preferSoftware: true, preferSoftwareAuto: false })
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

  it('clears preferSoftwareAuto whichever way the user sets the checkbox', () => {
    expect(qualityPatchOf({ preferSoftware: true })).toEqual({ preferSoftware: true, preferSoftwareAuto: false })
    expect(qualityPatchOf({ preferSoftware: false })).toEqual({ preferSoftware: false, preferSoftwareAuto: false })
  })

  it('leaves preferSoftwareAuto alone when the checkbox is not part of the patch', () => {
    expect(qualityPatchOf({ height: 1440 })).not.toHaveProperty('preferSoftwareAuto')
  })
})
