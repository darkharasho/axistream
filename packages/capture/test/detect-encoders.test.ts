import { describe, it, expect } from 'vitest'
import { detectEncoder } from '../src/detect-encoders.js'

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
