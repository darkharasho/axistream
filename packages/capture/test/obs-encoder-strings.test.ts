import { describe, it, expect } from 'vitest'
import { choosePreset, OBS_SIMPLE_ENCODERS, type EncoderKind } from '../src/encoder-presets.js'

const KINDS: EncoderKind[] = ['nvenc', 'vaapi', 'x264']

describe('OBS simple-output encoder strings', () => {
  // The bug this guards: OBS's get_simple_output_encoder()
  // (frontend/utility/SimpleOutput.cpp:88, obs-studio 32.1.2) returns
  // "obs_x264" for ANY string it does not recognize. Writing 'ffmpeg_vaapi'
  // there encoded in software while the stat chip said VAAPI, and no test
  // caught it because every test asserted the string we write, never that
  // OBS honors it.
  it('every streamEncoder AxiStream can emit is one OBS recognizes', () => {
    for (const kind of KINDS) {
      expect(OBS_SIMPLE_ENCODERS).toContain(choosePreset(kind, 1080, 60).streamEncoder)
    }
  })

  it('lists exactly the twelve values OBS 32.1.2 accepts', () => {
    expect([...OBS_SIMPLE_ENCODERS].sort()).toEqual([
      'amd', 'amd_av1', 'amd_hevc', 'apple_h264', 'apple_hevc', 'nvenc',
      'nvenc_av1', 'nvenc_hevc', 'qsv', 'qsv_av1', 'x264', 'x264_lowcpu',
    ])
  })
})
