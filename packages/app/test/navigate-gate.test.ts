import { describe, it, expect } from 'vitest'
import { isInAppNavigation } from '../src/main/navigate-gate.js'

const PACKAGED = 'file:///opt/AxiStream/resources/app/out/renderer/index.html'
const DEV = 'http://localhost:5173/index.html'

describe('isInAppNavigation', () => {
  it('allows the dev renderer to reload itself', () => {
    expect(isInAppNavigation('http://localhost:5173/index.html', DEV)).toBe(true)
  })

  it('allows the packaged renderer to reload itself', () => {
    expect(isInAppNavigation(`${PACKAGED}#/settings`, PACKAGED)).toBe(true)
  })

  it('refuses another origin in the dev window', () => {
    expect(isInAppNavigation('https://youtube.com/watch?v=x', DEV)).toBe(false)
  })

  it('refuses a remote page in the packaged window', () => {
    expect(isInAppNavigation('https://youtube.com/watch?v=x', PACKAGED)).toBe(false)
  })

  it('refuses the opaque-origin schemes an origin check would call same-origin', () => {
    // file://, data:, blob: and about: all report the origin 'null'.
    expect(isInAppNavigation('data:text/html,<script>alert(1)</script>', PACKAGED)).toBe(false)
    expect(isInAppNavigation('blob:null/0f5f', PACKAGED)).toBe(false)
    expect(isInAppNavigation('about:blank', PACKAGED)).toBe(false)
  })

  it('refuses a different file on disk', () => {
    expect(isInAppNavigation('file:///home/user/.ssh/id_ed25519', PACKAGED)).toBe(false)
  })

  it('refuses a target that will not parse', () => {
    expect(isInAppNavigation('not a url', PACKAGED)).toBe(false)
  })

  it('refuses everything when the window has no URL yet', () => {
    expect(isInAppNavigation(PACKAGED, '')).toBe(false)
  })
})
