import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { shouldShowWelcome } from '../src/main/onboarding.js'
import { INITIAL_STATE } from '../src/shared/state.js'

describe('shouldShowWelcome', () => {
  it('is true for a never-onboarded install', () => {
    expect(shouldShowWelcome('')).toBe(true)
  })

  it('is false once a build has stamped its version', () => {
    expect(shouldShowWelcome('1.0.0')).toBe(false)
  })
})

// The boot path in src/main/index.ts lives inside app.whenReady() and drives
// the real OBS sidecar, so it cannot be exercised from vitest. The defect this
// guards was purely structural: the derivation sat inside the
// `if (provisioned)` branch, so a brand-new (therefore unprovisioned) install
// published INITIAL_STATE.showWelcome === false and never saw the banner or
// the wizard during its first session. Read the source and assert the
// derivation runs on every boot path.
const indexPath = join(dirname(fileURLToPath(import.meta.url)), '../src/main/index.ts')
const source = readFileSync(indexPath, 'utf8')

describe('boot derives showWelcome on every path', () => {
  it('publishes it before the provisioned/unprovisioned split, exactly once', () => {
    const derivations = [...source.matchAll(/setState\(\{ showWelcome: shouldShowWelcome\(.+?\) \}\)/g)]
    expect(derivations).toHaveLength(1)

    const split = source.indexOf('const provisioned = config.load().provisioned')
    expect(split).toBeGreaterThan(-1)
    expect(derivations[0].index).toBeLessThan(split)
  })

  it('leaves no second derivation stranded inside the provisioned branch', () => {
    // Only dismissWelcome may write showWelcome after boot, and it writes false.
    const writes = [...source.matchAll(/showWelcome:\s*([^,}]+)/g)].map((m) => m[1].trim())
    expect(writes.sort()).toEqual(['false', 'shouldShowWelcome(settings.load().onboardedVersion)'])
  })

  it('a fresh unprovisioned install therefore flips the published default', () => {
    // INITIAL_STATE is what an unprovisioned boot publishes for anything the
    // boot path does not set — the value the bug left in place.
    expect(INITIAL_STATE.showWelcome).toBe(false)
    expect(shouldShowWelcome('')).toBe(true)
  })
})
