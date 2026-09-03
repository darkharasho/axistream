import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'

// Regression guard for the "base computer audio leaks onto the stream" bug.
//
// The persisted OBS scene collection holds 'AxiStream Desktop Audio' UNMUTED:
// ensureAudioInputs creates it that way, OBS saves the collection during
// startup, and AxiStream kills OBS on exit so the collection is never re-saved
// with the muted state the app applied. Every OBS start therefore comes up
// with desktop audio hot, and only `audio.applySettings()` mutes it back down.
//
// Boot ran that. The three handlers that rebuild the scene collection —
// `provision`, `repairCapture`, `switchSource` — reapplied only the per-app
// game-audio input, so after a capture change a user whose settings say
// "hear Discord + Guild Wars 2" got Discord + Guild Wars 2 *plus* the whole
// desktop mix (and the mic device reset to the collection's default).
//
// `applyAudioSettings()` is the single re-application point; these handlers
// are long single-line expressions with no other coverage, so this test reads
// the source directly.
const indexPath = join(dirname(fileURLToPath(import.meta.url)), '../src/main/index.ts')
const source = readFileSync(indexPath, 'utf8')

function extractHandler(name: string): string {
  const startRe = new RegExp(`^ {4}${name}:`, 'm')
  const startMatch = startRe.exec(source)
  if (!startMatch) throw new Error(`handler '${name}' not found in src/main/index.ts`)
  const bodyStart = startMatch.index + startMatch[0].length
  const rest = source.slice(bodyStart)
  const nextKeyRe = /^ {4}[A-Za-z_$][A-Za-z0-9_$]*:/m
  const nextMatch = nextKeyRe.exec(rest)
  const bodyEnd = nextMatch ? bodyStart + nextMatch.index : source.length
  return source.slice(bodyStart, bodyEnd)
}

describe('rebuild handlers reapply the full audio settings', () => {
  for (const name of ['provision', 'repairCapture', 'switchSource']) {
    it(`${name} calls applyAudioSettings() once per rebuild`, () => {
      const body = extractHandler(name)
      const rebuildCount = body.split('applyMasksRespectingVisibility()').length - 1
      // Sanity check the extraction found the rebuild call at all.
      expect(rebuildCount).toBeGreaterThan(0)
      expect(body.match(/await applyAudioSettings\(\)/g)?.length ?? 0).toBe(rebuildCount)
    })

    it(`${name} does not call gameAudio.ensure directly (that path skips desktop/mic)`, () => {
      expect(extractHandler(name)).not.toContain('gameAudio.ensure(')
    })
  }

  it('applyAudioSettings reapplies desktop/mic mute + device alongside the game-audio input', () => {
    const start = source.indexOf('const applyAudioSettings')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, start + 900)
    expect(body).toContain('ensureAudioInputs(')
    expect(body).toContain('audio.applySettings(')
    expect(body).toContain('gameAudio.ensure(')
  })
})
