import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StreamSettings } from '../src/main/StreamSettings.js'

const mk = () => new StreamSettings(join(mkdtempSync(join(tmpdir(), 'axi-')), 'settings.json'))

describe('onboardedVersion', () => {
  it('defaults to empty, meaning the welcome has never been dismissed', () => {
    expect(mk().load().onboardedVersion).toBe('')
  })

  it('round-trips through patch', () => {
    const s = mk()
    s.patch({ onboardedVersion: '1.0.0' })
    expect(s.load().onboardedVersion).toBe('1.0.0')
  })

  // settings.json written by an older build has no such key at all.
  it('coerces a non-string on disk back to the default', () => {
    const s = mk()
    s.patch({ onboardedVersion: 42 as unknown as string })
    expect(s.load().onboardedVersion).toBe('')
  })
})
