import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'

// Regression guard for the scene-rebuild landmine (see cf03496): OBS scene
// rebuilds (RemoveScene + CreateScene) destroy scene ITEMS while the
// underlying inputs survive, so any source backed by a scene item — the
// webcam included — goes silently invisible on the live stream unless it is
// re-added after every rebuild. Mic and desktop audio were dead on a live
// stream this exact way before cf03496 fixed it.
//
// The webcam's re-add is `applyWebcam()`, and it must run right after
// `applyMasksRespectingVisibility()` inside the three handlers that actually
// rebuild the OBS scene: `provision`, `repairCapture`, `switchSource`. Those
// handlers are long, single-line expressions in src/main/index.ts with no
// other test coverage, so a future edit could delete `await applyWebcam()`
// and nothing else would fail — the webcam would just vanish from the
// stream the next time a capture repairs, invisible until someone is live.
// This test reads the source directly to catch exactly that.
const indexPath = join(dirname(fileURLToPath(import.meta.url)), '../src/main/index.ts')
const source = readFileSync(indexPath, 'utf8')

// Top-level entries of the `handlers` object are consistently written as
// `    name: ...` (four-space indent). A handler's body is everything from
// its own `name:` line up to the next four-space-indented `key:` line.
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

describe('rebuild handlers re-add the webcam (scene-rebuild landmine guard)', () => {
  for (const name of ['provision', 'repairCapture', 'switchSource']) {
    it(`${name} calls applyWebcam() immediately after every applyMasksRespectingVisibility()`, () => {
      const body = extractHandler(name)
      const maskCallCount = body.split('applyMasksRespectingVisibility()').length - 1
      // Sanity check the extraction itself found the rebuild call at all —
      // otherwise the pairing assertion below would vacuously pass on zero.
      expect(maskCallCount).toBeGreaterThan(0)

      const pairedRe = /applyMasksRespectingVisibility\(\)\s*;\s*await applyWebcam\(\)/g
      const pairedCount = body.match(pairedRe)?.length ?? 0
      expect(pairedCount).toBe(maskCallCount)
    })
  }
})
