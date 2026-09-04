import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveEncoder, presetFor } from '@axistream/capture'
import { StreamSettings } from '../src/main/StreamSettings.js'
import type { Vendor } from '@axistream/capture/encoder-entries'

// The three units below are each well tested in isolation, but the composition
// main/index.ts actually runs at boot — load the persisted selection, resolve it
// against this machine, turn it into OBS settings — is not, because index.ts's
// boot IIFE cannot be imported. This runs the same pipeline directly, so the
// end-to-end product behaviour (what OBS gets, and what the chip claims) is
// pinned for the real settings.json shapes an upgrading user arrives with.
//
// The two assertions belong together on purpose: this feature exists because a
// build once wrote 'ffmpeg_vaapi' to OBS (which Simple output mode silently
// turns into x264) while the UI said "VAAPI". streamEncoder and label must
// never disagree.

let file: string
beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), 'axi-')), 'stream.json') })

function pipeline(stored: unknown, vendor: Vendor, platform: NodeJS.Platform = 'linux') {
  writeFileSync(file, JSON.stringify(stored))
  const { encoder } = new StreamSettings(file).load()
  const preset = presetFor(resolveEncoder(encoder, vendor, platform), 1080, 60)
  return { streamEncoder: preset.streamEncoder, label: preset.label }
}

describe('settings -> resolveEncoder -> presetFor', () => {
  it('an upgrade from the old software checkbox still encodes in software', () => {
    expect(pipeline({ preferSoftware: true }, 'nvidia')).toEqual({ streamEncoder: 'x264', label: 'x264' })
  })

  it('a settings file with no encoder key auto-promotes NVENC on an NVIDIA box', () => {
    expect(pipeline({}, 'nvidia')).toEqual({ streamEncoder: 'nvenc', label: 'NVENC H.264' })
  })

  it('a selection that outlived its GPU falls back to x264 and says so', () => {
    // NVENC AV1 persisted from an NVIDIA machine, now read on an AMD/Intel one.
    // It must not reach OBS, and the chip must not keep claiming NVENC AV1.
    expect(pipeline({ encoder: 'nvenc_av1' }, 'amd-intel')).toEqual({ streamEncoder: 'x264', label: 'x264' })
  })

  it('a garbage encoder value behaves exactly like an absent one', () => {
    const garbage = pipeline({ encoder: 'ffmpeg_vaapi' }, 'nvidia')
    expect(garbage).toEqual(pipeline({}, 'nvidia'))
    expect(garbage).toEqual({ streamEncoder: 'nvenc', label: 'NVENC H.264' })
  })
})
