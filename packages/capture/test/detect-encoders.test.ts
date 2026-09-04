import { describe, it, expect } from 'vitest'
import { detectVendor } from '../src/detect-encoders.js'

const deps = (over: Partial<Parameters<typeof detectVendor>[0]> = {}) => ({
  platform: 'linux' as NodeJS.Platform,
  existsSync: () => false,
  readdirSync: () => [] as string[],
  ...over,
})

describe('detectVendor', () => {
  it('nvidia device node → nvidia', () => {
    expect(detectVendor(deps({ existsSync: (p) => p === '/dev/nvidiactl' }))).toBe('nvidia')
    expect(detectVendor(deps({ existsSync: (p) => p === '/dev/nvidia0' }))).toBe('nvidia')
  })

  it('DRI render node without nvidia → amd-intel', () => {
    expect(detectVendor(deps({ readdirSync: () => ['card0', 'renderD128'] }))).toBe('amd-intel')
  })

  it('a card node without a render node is not enough', () => {
    expect(detectVendor(deps({ readdirSync: () => ['card0'] }))).toBe('none')
  })

  it('readdir throwing → treated as no DRI', () => {
    expect(detectVendor(deps({ readdirSync: () => { throw new Error('EACCES') } }))).toBe('none')
  })

  // Windows vendor detection is a follow-up; until it exists the picker
  // honestly shows software-only there, which is what already runs.
  it('non-linux → none for now', () => {
    expect(detectVendor(deps({ platform: 'win32', existsSync: () => true }))).toBe('none')
  })
})
