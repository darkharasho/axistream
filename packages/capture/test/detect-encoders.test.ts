import { describe, it, expect } from 'vitest'
import { detectEncoder, detectVendor } from '../src/detect-encoders.js'

const deps = (over: Partial<Parameters<typeof detectEncoder>[0]> = {}) => ({
  platform: 'linux' as NodeJS.Platform,
  existsSync: () => false,
  readdirSync: () => [] as string[],
  ...over,
})

describe('detectEncoder', () => {
  it('nvidia device node → nvenc', () => {
    expect(detectEncoder(deps({ existsSync: (p) => p === '/dev/nvidiactl' }))).toBe('nvenc')
    expect(detectEncoder(deps({ existsSync: (p) => p === '/dev/nvidia0' }))).toBe('nvenc')
  })

  it('DRI render node without nvidia → vaapi', () => {
    expect(detectEncoder(deps({ readdirSync: () => ['card0', 'renderD128'] }))).toBe('vaapi')
  })

  it('neither → x264', () => {
    expect(detectEncoder(deps())).toBe('x264')
  })

  it('readdir throwing → treated as no DRI', () => {
    expect(detectEncoder(deps({ readdirSync: () => { throw new Error('EACCES') } }))).toBe('x264')
  })

  it('non-linux platforms → x264 for now', () => {
    expect(detectEncoder(deps({ platform: 'win32', existsSync: () => true, readdirSync: () => ['renderD128'] }))).toBe('x264')
  })
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
