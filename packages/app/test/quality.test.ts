import { describe, it, expect } from 'vitest'
import { qualityOf, qualityViewOf } from '../src/main/quality.js'
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
